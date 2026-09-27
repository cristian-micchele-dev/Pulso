import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, LessThan, And, Repository } from 'typeorm';
import { likePattern, searchWords } from '../../../../shared/infra/persistence/text-search';
import { AppointmentStatus } from '../../domain/appointment-status.enum';
import { AppointmentRepository, AppointmentFilters, DaySummaryRow } from '../../appointment.repository.port';
import { APP_TIME_ZONE } from '../../../../shared/infra/time/format';
import { Appointment } from '../../domain/appointment';
import { TimeSlotUnavailableError } from '../../domain/exceptions';
import { AppointmentOrmEntity } from './appointment.entity';

/** Violación de unicidad en Postgres. */
const UNIQUE_VIOLATION = '23505';

/**
 * Reconoce el choque por horario, y sólo ese.
 *
 * Se mira el nombre del constraint y no el mensaje: el mensaje cambia con el
 * idioma y la versión del servidor. Cualquier otra violación de unicidad —un id
 * repetido, por ejemplo— es un problema distinto y tiene que seguir subiendo
 * como está, sin disfrazarse de conflicto de agenda.
 */
function esHorarioTomado(error: unknown): boolean {
  const driver = (error as { driverError?: { code?: string; constraint?: string } })?.driverError;
  return driver?.code === UNIQUE_VIOLATION
    && driver?.constraint === 'appointments_doctor_id_date_time_key';
}

@Injectable()
export class TypeOrmAppointmentRepository implements AppointmentRepository {
  constructor(@InjectRepository(AppointmentOrmEntity) private readonly repo: Repository<AppointmentOrmEntity>) {}

  private map(e: AppointmentOrmEntity): Appointment {
    return new Appointment(e.id, e.doctorId, e.patientId, e.specialtyId, e.dateTime, e.durationMinutes, e.status, e.notes, e.cancellationReason, e.createdAt, e.code, e.diagnosis);
  }

  async findById(id: string) {
    const e = await this.repo.findOne({ where: { id } });
    return e ? this.map(e) : undefined;
  }

  async findAll(filters: AppointmentFilters): Promise<[Appointment[], number]> {
    const qb = this.repo.createQueryBuilder('a');
    if (filters.doctorId) qb.andWhere('a.doctor_id = :doctorId', { doctorId: filters.doctorId });
    if (filters.patientId) qb.andWhere('a.patient_id = :patientId', { patientId: filters.patientId });
    if (filters.specialtyId) qb.andWhere('a.specialty_id = :specialtyId', { specialtyId: filters.specialtyId });
    if (filters.status) qb.andWhere('a.status = :status', { status: filters.status });
    if (filters.from) qb.andWhere('a.date_time >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('a.date_time <= :to', { to: filters.to });

    // `search_text` ya trae código, paciente y médico juntos y plegados, puesto
    // por trigger. Buscar deja de ser un OR entre tres tablas —que Postgres tiene
    // que unir antes de filtrar, y por eso ningún índice entraba— y pasa a ser un
    // LIKE sobre una columna con índice de trigramas. Cada palabra tiene que
    // aparecer en algún lado: se piden todas, en cualquier orden.
    searchWords(filters.q ?? '').forEach((word, i) => {
      const key = `q${i}`;
      qb.andWhere(`a.search_text LIKE :${key} ESCAPE '\\'`, { [key]: likePattern(word) });
    });

    // La propiedad, no la columna: con joins y paginación TypeORM arma una
    // subconsulta DISTINCT y necesita resolver el ORDER BY contra el metadata.
    qb.orderBy('a.dateTime', filters.order === 'desc' ? 'DESC' : 'ASC');
    if (filters.skip !== undefined) qb.skip(filters.skip);
    if (filters.take !== undefined) qb.take(filters.take);
    const [entities, total] = await qb.getManyAndCount();
    return [entities.map(e => this.map(e)), total];
  }

  // Grouped in the clinic's time zone so a 22:00 appointment lands on the right calendar day.
  async countByDayAndStatus(filters: { doctorId?: string; from: Date; to: Date }): Promise<DaySummaryRow[]> {
    // '::int' would be read by TypeORM as a named parameter, hence CAST.
    const day = `to_char(a.date_time AT TIME ZONE :tz, 'YYYY-MM-DD')`;
    const qb = this.repo.createQueryBuilder('a')
      .select(day, 'date')
      .addSelect('a.status', 'status')
      .addSelect('CAST(COUNT(*) AS int)', 'count')
      .where('a.date_time >= :from AND a.date_time <= :to', { from: filters.from, to: filters.to })
      .setParameter('tz', APP_TIME_ZONE)
      .groupBy(day).addGroupBy('a.status')
      .orderBy(day, 'ASC');
    if (filters.doctorId) qb.andWhere('a.doctor_id = :doctorId', { doctorId: filters.doctorId });
    return qb.getRawMany<DaySummaryRow>();
  }

  async findByDoctorAndDateTime(doctorId: string, dateTime: Date) {
    const entities = await this.repo.find({ where: { doctorId, dateTime } });
    return entities.map(e => this.map(e));
  }

  async findByPatientSpecialtyAndDateRange(patientId: string, specialtyId: string, from: Date, to: Date) {
    const entities = await this.repo.find({ where: { patientId, specialtyId, dateTime: Between(from, to) } });
    return entities.map(e => this.map(e));
  }

  async findActiveBetween(from: Date, to: Date) {
    const entities = await this.repo.find({
      where: { status: In([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]), dateTime: And(MoreThanOrEqual(from), LessThan(to)) },
      order: { dateTime: 'ASC' },
    });
    return entities.map(e => this.map(e));
  }

  async nextCode(): Promise<string> {
    // La secuencia es la unica forma de que dos pedidos simultaneos no se lleven
    // el mismo numero. Calcularlo leyendo el maximo es una carrera perdida.
    const [{ nextval }] = await this.repo.query(`SELECT nextval('appointment_code_seq')`) as [{ nextval: string }];
    return `TM-${String(nextval).padStart(5, '0')}`;
  }

  async save(a: Appointment) {
    try {
      return await this.insert(a);
    } catch (error) {
      // El cinturon de seguridad. La validacion previa cubre el 99% de los casos
      // con un mensaje mejor, pero entre validar y grabar hay una ventana: si
      // otro entro primero, el constraint lo frena y eso tiene que llegar al
      // usuario como "ese horario ya esta tomado", no como un error interno.
      if (esHorarioTomado(error)) throw new TimeSlotUnavailableError();
      throw error;
    }
  }

  private async insert(a: Appointment) {
    const e = await this.repo.save(Object.assign(new AppointmentOrmEntity(), {
      id: a.id, code: a.code, doctorId: a.doctorId, patientId: a.patientId, specialtyId: a.specialtyId,
      dateTime: a.dateTime, durationMinutes: a.durationMinutes, status: a.status, notes: a.notes, cancellationReason: a.cancellationReason,
    }));
    return this.map(e);
  }

  async update(a: Appointment) {
    await this.repo.update(a.id, { status: a.status, notes: a.notes, diagnosis: a.diagnosis, cancellationReason: a.cancellationReason, dateTime: a.dateTime, durationMinutes: a.durationMinutes });
  }
}
