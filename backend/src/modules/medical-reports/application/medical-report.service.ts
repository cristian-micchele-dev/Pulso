import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MedicalReportRepository, MEDICAL_REPORT_REPOSITORY } from '../medical-report.repository.port';
import { AppointmentRepository, APPOINTMENT_REPOSITORY } from '../../appointments/appointment.repository.port';
import { MedicalReport } from '../domain/medical-report';
import { MedicalReportNotFoundError } from '../domain/medical-report-not-found.exception';
import { AppointmentNotFoundError } from '../../appointments/domain/exceptions';
import { PatientNotFoundError } from '../../patients/domain/patient-not-found.exception';
import { DomainError, ForbiddenError } from '../../../shared/domain/errors';
import { AppointmentStatus } from '../../appointments/domain/appointment-status.enum';
import { CreateMedicalReportDto } from './dto/create-medical-report.dto';
import { CreatePatientReportDto } from './dto/create-patient-report.dto';
import { PaginatedResult } from '../../../shared/application/pagination';
import { PatientRepository, PATIENT_REPOSITORY } from '../../patients/patient.repository.port';
import { DoctorRepository, DOCTOR_REPOSITORY } from '../../doctors/doctor.repository.port';
import { DoctorNotFoundError } from '../../doctors/domain/doctor-not-found.exception';
import { MedicalRecordAccessPolicy } from '../../appointments/application/medical-record-access.policy';
import { Actor } from '../../users/domain/actor';
import { Role } from '../../users/domain/user';
import { EXTENSION_BY_TYPE, sniffFileType, type SniffedType } from '../../../shared/infra/files/sniff';
import { ALMACEN_DE_ARCHIVOS, AlmacenDeArchivos, CARPETA_INFORMES } from '../../../shared/application/file-storage.port';

const ALLOWED_UPLOADS: SniffedType[] = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * What the file says it is, not what the browser said. The declared mime type and
 * the extension of the original name both come from the client, so neither decides
 * what we store or what we later serve back.
 */
function assertAllowedUpload(file: Express.Multer.File): SniffedType {
  const type = sniffFileType(file.buffer);
  if (!type || !ALLOWED_UPLOADS.includes(type)) {
    throw new DomainError('UNSUPPORTED_FILE', 'El informe debe ser un PDF o una imagen JPG o PNG', 400);
  }
  return type;
}

@Injectable()
export class MedicalReportService {
  constructor(
    @Inject(MEDICAL_REPORT_REPOSITORY) private readonly reports: MedicalReportRepository,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(DOCTOR_REPOSITORY) private readonly doctors: DoctorRepository,
    private readonly access: MedicalRecordAccessPolicy,
    @Inject(ALMACEN_DE_ARCHIVOS) private readonly archivos: AlmacenDeArchivos,
  ) {}

  // The JWT carries the user id; ownership is checked against the doctor profile id.
  private async resolveDoctorId(userId: string): Promise<string> {
    const doctor = await this.doctors.findByUserId(userId);
    if (!doctor) throw new DoctorNotFoundError(userId);
    return doctor.id;
  }

  async upload(
    doctorUserId: string,
    appointmentId: string,
    dto: CreateMedicalReportDto,
    file: Express.Multer.File,
  ): Promise<ReturnType<MedicalReport['toPublic']>> {
    const doctorId = await this.resolveDoctorId(doctorUserId);
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) throw new AppointmentNotFoundError(appointmentId);
    if (appointment.doctorId !== doctorId) throw new ForbiddenError();
    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new ForbiddenError();
    }

    const type = assertAllowedUpload(file);
    const fileName = `${randomUUID()}.${EXTENSION_BY_TYPE[type]}`;
    await this.archivos.guardar(CARPETA_INFORMES, fileName, file.buffer, type);

    const report = new MedicalReport(
      randomUUID(),
      appointmentId,
      doctorId,
      appointment.patientId,
      dto.title,
      dto.description ?? null,
      fileName,
      file.originalname,
      type,
      file.size,
    );

    const saved = await this.reports.save(report);
    return saved.toPublic();
  }

  async uploadForPatient(
    doctorUserId: string,
    patientId: string,
    dto: CreatePatientReportDto,
    file: Express.Multer.File,
  ): Promise<ReturnType<MedicalReport['toPublic']>> {
    const doctorId = await this.resolveDoctorId(doctorUserId);
    const patient = await this.patients.findById(patientId);
    if (!patient) throw new PatientNotFoundError(patientId);
    // Writing into a chart needs the same treating relationship as reading it;
    // otherwise a doctor could file a report they are not even allowed to see.
    await this.access.assertCanRead({ sub: doctorUserId, role: Role.DOCTOR }, patientId);

    const type = assertAllowedUpload(file);
    const fileName = `${randomUUID()}.${EXTENSION_BY_TYPE[type]}`;
    await this.archivos.guardar(CARPETA_INFORMES, fileName, file.buffer, type);

    const report = new MedicalReport(
      randomUUID(),
      null,
      doctorId,
      patientId,
      dto.title,
      dto.description ?? null,
      fileName,
      file.originalname,
      type,
      file.size,
    );

    const saved = await this.reports.save(report);
    return saved.toPublic();
  }

  async findByAppointment(appointmentId: string, actor: Actor): Promise<ReturnType<MedicalReport['toPublic']>[]> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) throw new AppointmentNotFoundError(appointmentId);
    await this.access.assertCanRead(actor, appointment.patientId);
    const list = await this.reports.findByAppointmentId(appointmentId);
    return list.map(r => r.toPublic());
  }

  async findByPatient(
    patientId: string,
    page: number,
    limit: number,
    actor: Actor,
  ): Promise<PaginatedResult<ReturnType<MedicalReport['toPublic']>>> {
    await this.access.assertCanRead(actor, patientId);
    const { data, total } = await this.reports.findByPatientId(patientId, page, limit);
    return {
      data: data.map(r => r.toPublic()),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async findReadable(id: string, actor: Actor): Promise<MedicalReport> {
    const report = await this.reports.findById(id);
    if (!report) throw new MedicalReportNotFoundError(id);
    await this.access.assertCanRead(actor, report.patientId);
    return report;
  }

  async findOne(id: string, actor: Actor): Promise<ReturnType<MedicalReport['toPublic']>> {
    return (await this.findReadable(id, actor)).toPublic();
  }

  /**
   * Devuelve el CONTENIDO y no una ruta: una ruta sólo tiene sentido si el
   * almacén es un disco, y atarse a eso era el problema original. Con el tope
   * de 10 MB por archivo, traerlo a memoria es aceptable.
   */
  async readFile(id: string, actor: Actor): Promise<{ contenido: Buffer; report: MedicalReport }> {
    const report = await this.findReadable(id, actor);
    return { contenido: await this.archivos.leer(CARPETA_INFORMES, report.fileName), report };
  }

  async delete(id: string, doctorUserId: string): Promise<void> {
    const doctorId = await this.resolveDoctorId(doctorUserId);
    const report = await this.reports.findById(id);
    if (!report) throw new MedicalReportNotFoundError(id);
    if (report.doctorId !== doctorId) throw new ForbiddenError();

    // El puerto promete que borrar es idempotente, asi que no hace falta
    // envolverlo: que el archivo ya no este es el resultado buscado.
    await this.archivos.borrar(CARPETA_INFORMES, report.fileName);

    await this.reports.delete(id);
  }
}
