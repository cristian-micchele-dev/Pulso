import { Appointment } from './domain/appointment';
import { AppointmentStatus } from './domain/appointment-status.enum';

export type AppointmentOrder = 'asc' | 'desc';

export interface AppointmentFilters {
  doctorId?: string;
  patientId?: string;
  specialtyId?: string;
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
  /** 'asc' para lo que viene (lo más próximo primero), 'desc' para mirar hacia atrás. */
  order?: AppointmentOrder;
  /** Texto libre: código del turno, nombre del paciente o del médico. */
  q?: string;
  skip?: number;
  take?: number;
}

export interface DaySummaryRow { date: string; status: AppointmentStatus; count: number }

export interface AppointmentRepository {
  findById(id: string): Promise<Appointment | undefined>;
  /** Appointments per clinic-local calendar day and status within [from, to]. */
  countByDayAndStatus(filters: { doctorId?: string; from: Date; to: Date }): Promise<DaySummaryRow[]>;
  findAll(filters: AppointmentFilters): Promise<[Appointment[], number]>;
  findByDoctorAndDateTime(doctorId: string, dateTime: Date): Promise<Appointment[]>;
  findByPatientSpecialtyAndDateRange(patientId: string, specialtyId: string, from: Date, to: Date): Promise<Appointment[]>;
  /** Codigo nuevo y unico, atomico aunque lo pidan mil a la vez. */
  nextCode(): Promise<string>;
  /** PENDING/CONFIRMED appointments with dateTime in [from, to). */
  findActiveBetween(from: Date, to: Date): Promise<Appointment[]>;
  save(appointment: Appointment): Promise<Appointment>;
  update(appointment: Appointment): Promise<void>;
}

export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
