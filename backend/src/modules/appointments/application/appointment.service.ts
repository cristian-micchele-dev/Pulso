import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Clock, CLOCK } from '../../../shared/application/ports';
import { formatDateTime } from '../../../shared/infra/time/format';
import { Appointment } from '../domain/appointment';
import { AppointmentStatus } from '../domain/appointment-status.enum';
import { AppointmentNotFoundError, InvalidStatusTransitionError } from '../domain/exceptions';
import { NoDoubleBookingRule } from '../domain/rules/no-double-booking.rule';
import { WithinAvailabilityRule } from '../domain/rules/within-availability.rule';
import { NoSameDaySpecialtyRule } from '../domain/rules/no-same-day-specialty.rule';
import { CancellationWindowRule } from '../domain/rules/cancellation-window.rule';
import { AppointmentRepository, APPOINTMENT_REPOSITORY } from '../appointment.repository.port';
import { DoctorRepository, AvailabilityRepository, ScheduleBlockRepository, DOCTOR_REPOSITORY, AVAILABILITY_REPOSITORY, SCHEDULE_BLOCK_REPOSITORY } from '../../doctors/doctor.repository.port';
import { PatientRepository, PATIENT_REPOSITORY } from '../../patients/patient.repository.port';
import { DoctorNotFoundError } from '../../doctors/domain/doctor-not-found.exception';
import { PatientNotFoundError } from '../../patients/domain/patient-not-found.exception';
import { CreateAppointmentDto, CancelAppointmentDto, CompleteAppointmentDto, QueryAppointmentsDto, RescheduleAppointmentDto, SummaryAppointmentsDto } from './dto/appointment.dto';
import { Role } from '../../users/domain/user';
import { Actor } from '../../users/domain/actor';
import { ForbiddenError } from '../../../shared/domain/errors';
import { PaginatedResult } from '../../../shared/application/pagination';
import { Doctor } from '../../doctors/domain/doctor';
import { clinicDayRange } from '../../../shared/infra/time/format';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-entry';
import { NotificationService } from '../../notifications/application/notification.service';
import { NotificationType } from '../../notifications/domain/notification';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A bare calendar date means "that whole day on the clinic clock"; a full instant is taken as-is.
function parseRangeBound(value: string, edge: 'start' | 'end'): Date {
  return DATE_ONLY.test(value) ? clinicDayRange(value)[edge] : new Date(value);
}

export type EnrichedAppointment = ReturnType<Appointment['toPublic']> & {
  doctor?: { id: string; licenseNumber: string; user?: Doctor['user']; specialty?: Doctor['specialty'] };
  patient?: { id: string; name: string; email: string | null };
};

@Injectable()
export class AppointmentService {
  private readonly noDoubleBooking = new NoDoubleBookingRule();
  private readonly withinAvailability = new WithinAvailabilityRule();
  private readonly noSameDaySpecialty = new NoSameDaySpecialtyRule();
  private readonly cancellationWindow = new CancellationWindowRule();

  constructor(
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(DOCTOR_REPOSITORY) private readonly doctors: DoctorRepository,
    @Inject(AVAILABILITY_REPOSITORY) private readonly availabilities: AvailabilityRepository,
    @Inject(SCHEDULE_BLOCK_REPOSITORY) private readonly scheduleBlockRepo: ScheduleBlockRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // Resolves the actor to the doctor profile it owns. ADMIN passes every check.
  private async assertCanAccess(actor: Actor, target: { doctorId: string }) {
    if (actor.role === Role.DOCTOR) {
      const doctor = await this.doctors.findByUserId(actor.sub);
      if (!doctor) throw new DoctorNotFoundError(actor.sub);
      if (doctor.id !== target.doctorId) throw new ForbiddenError();
    }
  }

  private async findOwned(id: string, actor: Actor) {
    const a = await this.appointments.findById(id);
    if (!a) throw new AppointmentNotFoundError(id);
    await this.assertCanAccess(actor, a);
    return a;
  }

  async create(dto: CreateAppointmentDto, actor: Actor) {
    await this.assertCanAccess(actor, dto);
    const doctor = await this.doctors.findById(dto.doctorId);
    if (!doctor) throw new DoctorNotFoundError(dto.doctorId);
    const patient = await this.patients.findById(dto.patientId);
    if (!patient) throw new PatientNotFoundError(dto.patientId);
    const dateTime = new Date(dto.dateTime);

    await this.withinAvailability.validate(doctor.id, dateTime, this.availabilities);
    await this.noDoubleBooking.validate(doctor.id, dateTime, this.appointments);
    await this.noSameDaySpecialty.validate(patient.id, doctor.specialtyId, dateTime, this.appointments);

    const overlapping = await this.scheduleBlockRepo.findOverlapping(doctor.id, dateTime);
    if (overlapping.length > 0) {
      throw new BadRequestException('El doctor no está disponible en esa fecha (bloqueo de agenda)');
    }

    const code = await this.appointments.nextCode();

    const appointment = new Appointment(
      randomUUID(), doctor.id, patient.id, doctor.specialtyId,
      dateTime, dto.durationMinutes ?? 30, AppointmentStatus.PENDING, dto.notes ?? null,
      null, new Date(), code,
    );
    const saved = await this.appointments.save(appointment);
    // Whoever books is rarely the doctor, so the message carries the two facts
    // they need before opening anything: the patient and the moment.
    await this.notifications.notify(
      doctor.userId,
      NotificationType.APPOINTMENT_CREATED,
      `Nuevo turno: ${patient.name} — ${formatDateTime(dateTime)}`,
      saved.id,
    );
    return saved.toPublic();
  }

  // Batch-loads the doctor and patient of each appointment (2 queries total, never N+1).
  private async enrich(list: Appointment[]): Promise<EnrichedAppointment[]> {
    const [doctors, patients] = await Promise.all([
      this.doctors.findByIds([...new Set(list.map(a => a.doctorId))]),
      this.patients.findByIds([...new Set(list.map(a => a.patientId))]),
    ]);
    const doctorById = new Map(doctors.map(d => [d.id, { id: d.id, licenseNumber: d.licenseNumber, user: d.user, specialty: d.specialty }]));
    const patientById = new Map(patients.map(p => [p.id, { id: p.id, name: p.name, email: p.email }]));
    return list.map(a => ({ ...a.toPublic(), doctor: doctorById.get(a.doctorId), patient: patientById.get(a.patientId) }));
  }

  // Calendar feed: counts per day/status instead of rows, so a month never hits the page limit.
  async summary(query: SummaryAppointmentsDto, userId: string, role: Role) {
    const filters: { doctorId?: string; from: Date; to: Date } = { from: parseRangeBound(query.from, 'start'), to: parseRangeBound(query.to, 'end') };
    if (role === Role.DOCTOR) {
      const doctor = await this.doctors.findByUserId(userId);
      if (!doctor) throw new DoctorNotFoundError(userId);
      filters.doctorId = doctor.id;
    }
    return this.appointments.countByDayAndStatus(filters);
  }

  async findAll(query: QueryAppointmentsDto, userId: string, role: Role): Promise<PaginatedResult<EnrichedAppointment>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    // Por defecto la agenda se lee hacia adelante: lo más próximo primero. Mirar
    // el historial es pedirlo al revés, explícitamente.
    const filters = { ...query, order: query.order ?? 'asc' as const, q: query.q?.trim() || undefined, from: query.from ? parseRangeBound(query.from, 'start') : undefined, to: query.to ? parseRangeBound(query.to, 'end') : undefined, skip, take: limit };
    if (role === Role.DOCTOR) {
      const doctor = await this.doctors.findByUserId(userId);
      if (!doctor) throw new DoctorNotFoundError(userId);
      filters.doctorId = doctor.id;
    }
    const [list, total] = await this.appointments.findAll(filters);
    return { data: await this.enrich(list), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, actor: Actor): Promise<EnrichedAppointment> {
    const a = await this.findOwned(id, actor);
    const [enriched] = await this.enrich([a]);
    return enriched;
  }

  async confirm(id: string, actor: Actor) {
    const a = await this.findOwned(id, actor);
    a.confirm();
    await this.appointments.update(a);
    return a.toPublic();
  }

  /** Notifications address an account, and an appointment only knows the doctor profile. */
  private async notifyDoctor(doctorId: string, type: NotificationType, message: string, appointmentId: string) {
    const doctor = await this.doctors.findById(doctorId);
    if (doctor) await this.notifications.notify(doctor.userId, type, message, appointmentId);
  }

  async cancel(id: string, dto: CancelAppointmentDto, actor: Actor) {
    const a = await this.findOwned(id, actor);
    this.cancellationWindow.validate(a.dateTime, this.clock.now());
    a.cancel(dto.reason);
    await this.appointments.update(a);
    await this.audit.record(actor, AuditAction.APPOINTMENT_CANCELLED, 'appointment', a.id, { code: a.code, patientId: a.patientId });
    await this.notifyDoctor(
      a.doctorId,
      NotificationType.APPOINTMENT_CANCELLED,
      `Turno cancelado: ${a.code} — ${formatDateTime(a.dateTime)}`,
      a.id,
    );
    return a.toPublic();
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto, actor: Actor): Promise<ReturnType<Appointment['toPublic']>> {
    const a = await this.findOwned(id, actor);
    if (a.status === AppointmentStatus.COMPLETED || a.status === AppointmentStatus.CANCELLED) {
      throw new InvalidStatusTransitionError(a.status, 'RESCHEDULED');
    }
    const newDateTime = new Date(dto.dateTime);
    await this.withinAvailability.validate(a.doctorId, newDateTime, this.availabilities);
    await this.noDoubleBooking.validate(a.doctorId, newDateTime, this.appointments);
    a.dateTime = newDateTime;
    await this.appointments.update(a);
    await this.notifyDoctor(
      a.doctorId,
      NotificationType.APPOINTMENT_RESCHEDULED,
      `Turno ${a.code} reprogramado: ${formatDateTime(newDateTime)}`,
      a.id,
    );
    return a.toPublic();
  }

  async complete(id: string, dto: CompleteAppointmentDto, actor: Actor) {
    const a = await this.findOwned(id, actor);
    a.complete();
    if (dto.diagnosis !== undefined) a.diagnosis = dto.diagnosis ?? null;
    if (dto.notes !== undefined) a.notes = dto.notes ?? null;
    await this.appointments.update(a);
    return a.toPublic();
  }
}
