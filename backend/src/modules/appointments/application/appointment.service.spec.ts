import { AppointmentService } from './appointment.service';
import { Appointment } from '../domain/appointment';
import { AppointmentStatus } from '../domain/appointment-status.enum';
import { InvalidStatusTransitionError } from '../domain/exceptions';
import { Doctor } from '../../doctors/domain/doctor';
import { Patient } from '../../patients/domain/patient';
import { Availability } from '../../doctors/domain/availability';
import { Role } from '../../users/domain/user';

describe('Appointment (domain)', () => {
  const make = (status: AppointmentStatus) =>
    new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, status);

  describe('confirm()', () => {
    it('transiciona de PENDING a CONFIRMED', () => {
      const a = make(AppointmentStatus.PENDING);
      a.confirm();
      expect(a.status).toBe(AppointmentStatus.CONFIRMED);
    });
    it('lanza InvalidStatusTransitionError si no está PENDING', () => {
      expect(() => make(AppointmentStatus.CONFIRMED).confirm()).toThrow(InvalidStatusTransitionError);
      expect(() => make(AppointmentStatus.CANCELLED).confirm()).toThrow(InvalidStatusTransitionError);
    });
  });

  describe('cancel()', () => {
    it('transiciona de PENDING a CANCELLED y guarda motivo', () => {
      const a = make(AppointmentStatus.PENDING);
      a.cancel('Personal');
      expect(a.status).toBe(AppointmentStatus.CANCELLED);
      expect(a.cancellationReason).toBe('Personal');
    });
    it('transiciona de CONFIRMED a CANCELLED', () => {
      const a = make(AppointmentStatus.CONFIRMED);
      a.cancel();
      expect(a.status).toBe(AppointmentStatus.CANCELLED);
      expect(a.cancellationReason).toBeNull();
    });
    it('lanza InvalidStatusTransitionError si ya está CANCELLED o COMPLETED', () => {
      expect(() => make(AppointmentStatus.CANCELLED).cancel()).toThrow(InvalidStatusTransitionError);
      expect(() => make(AppointmentStatus.COMPLETED).cancel()).toThrow(InvalidStatusTransitionError);
    });
  });

  describe('complete()', () => {
    it('transiciona de CONFIRMED a COMPLETED', () => {
      const a = make(AppointmentStatus.CONFIRMED);
      a.complete();
      expect(a.status).toBe(AppointmentStatus.COMPLETED);
    });
    it('lanza InvalidStatusTransitionError si no está CONFIRMED', () => {
      expect(() => make(AppointmentStatus.PENDING).complete()).toThrow(InvalidStatusTransitionError);
      expect(() => make(AppointmentStatus.CANCELLED).complete()).toThrow(InvalidStatusTransitionError);
    });
  });
});

describe('AppointmentService', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const appointments: any = { findById: jest.fn(), findAll: jest.fn(), countByDayAndStatus: jest.fn(), findByDoctorAndDateTime: jest.fn(), findByPatientSpecialtyAndDateRange: jest.fn(), save: jest.fn(), update: jest.fn(), nextCode: jest.fn() };
  const doctors: any = { findById: jest.fn(), findByUserId: jest.fn(), findByIds: jest.fn() };
  const availabilities: any = { findByDoctorAndDay: jest.fn() };
  const scheduleBlocks: any = { findOverlapping: jest.fn() };
  const patients: any = { findById: jest.fn(), findByIds: jest.fn() };
  const clock = { now: () => now };

  const admin = { sub: 'admin-1', role: Role.ADMIN };
  const service = () => new AppointmentService(appointments, doctors, availabilities, scheduleBlocks, patients, clock, { record: jest.fn() } as any, { notify: jest.fn() } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    appointments.findById.mockResolvedValue(undefined);
    appointments.findAll.mockResolvedValue([[], 0]);
    appointments.countByDayAndStatus.mockResolvedValue([]);
    appointments.findByDoctorAndDateTime.mockResolvedValue([]);
    appointments.findByPatientSpecialtyAndDateRange.mockResolvedValue([]);
    appointments.nextCode.mockResolvedValue('TM-00001');
    doctors.findById.mockResolvedValue(undefined);
    doctors.findByUserId.mockResolvedValue(undefined);
    availabilities.findByDoctorAndDay.mockResolvedValue([]);
    scheduleBlocks.findOverlapping.mockResolvedValue([]);
    patients.findById.mockResolvedValue(undefined);
    patients.findByIds.mockResolvedValue([]);
    doctors.findByIds.mockResolvedValue([]);
  });

  const setupValidCreate = () => {
    doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
    patients.findById.mockResolvedValue(new Patient('p1', 'u2'));
    // lunes, bloque 09:00-17:00
    availabilities.findByDoctorAndDay.mockResolvedValue([new Availability('av1', 'd1', 1, '09:00', '17:00', 30)]);
    appointments.save.mockImplementation(async (a: Appointment) => a);
  };

  describe('create', () => {
    it('crea turno cuando todas las validaciones pasan', async () => {
      setupValidCreate();
      const result = await service().create({ doctorId: 'd1', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, admin);
      expect(result.doctorId).toBe('d1');
      expect(result.patientId).toBe('p1');
      expect(result.status).toBe(AppointmentStatus.PENDING);
    });

    it('rechaza si médico no existe', async () => {
      await expect(service().create({ doctorId: 'd1', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, admin))
        .rejects.toMatchObject({ status: 404 });
    });

    it('rechaza si paciente no existe', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().create({ doctorId: 'd1', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, admin))
        .rejects.toMatchObject({ status: 404 });
    });

    it('rechaza si está fuera de disponibilidad', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      patients.findById.mockResolvedValue(new Patient('p1', 'u2'));
      // sin disponibilidad para lunes
      await expect(service().create({ doctorId: 'd1', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, admin))
        .rejects.toMatchObject({ status: 400, code: 'OUTSIDE_AVAILABILITY' });
    });

    it('rechaza double booking', async () => {
      setupValidCreate();
      const existing = new Appointment('a-existing', 'd1', 'p2', 's1', new Date('2026-09-07T13:00:00Z'), 30, AppointmentStatus.PENDING);
      appointments.findByDoctorAndDateTime.mockResolvedValue([existing]);
      await expect(service().create({ doctorId: 'd1', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, admin))
        .rejects.toMatchObject({ status: 409, code: 'TIME_SLOT_UNAVAILABLE' });
    });

    it('rechaza misma especialidad mismo día', async () => {
      setupValidCreate();
      const existing = new Appointment('a-existing', 'd1', 'p1', 's1', new Date('2026-09-07T09:00:00Z'), 30, AppointmentStatus.CONFIRMED);
      appointments.findByPatientSpecialtyAndDateRange.mockResolvedValue([existing]);
      await expect(service().create({ doctorId: 'd1', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, admin))
        .rejects.toMatchObject({ status: 409, code: 'DUPLICATE_SPECIALTY_BOOKING' });
    });
  });

  describe('summary (calendario)', () => {
    it('ADMIN: agrega todos los turnos del rango en días completos del hospital', async () => {
      appointments.countByDayAndStatus.mockResolvedValue([{ date: '2026-09-21', status: AppointmentStatus.PENDING, count: 3 }]);
      const result = await service().summary({ from: '2026-09-01', to: '2026-09-30' }, 'admin-id', Role.ADMIN);
      expect(result).toEqual([{ date: '2026-09-21', status: 'PENDING', count: 3 }]);
      const call = appointments.countByDayAndStatus.mock.calls[0][0];
      expect(call.doctorId).toBeUndefined();
      expect(call.from.toISOString()).toBe('2026-09-01T03:00:00.000Z');
      expect(call.to.toISOString()).toBe('2026-10-01T02:59:59.999Z');
    });

    it('DOCTOR: solo cuenta los turnos de su propia agenda', async () => {
      doctors.findByUserId.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await service().summary({ from: '2026-09-01', to: '2026-09-30' }, 'u1', Role.DOCTOR);
      expect(appointments.countByDayAndStatus).toHaveBeenCalledWith(expect.objectContaining({ doctorId: 'd1' }));
    });

    it('DOCTOR sin perfil recibe 404', async () => {
      await expect(service().summary({ from: '2026-09-01', to: '2026-09-30' }, 'ghost', Role.DOCTOR)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('findAll', () => {
    it('por defecto lo más próximo primero: la agenda se lee hacia adelante', async () => {
      await service().findAll({}, 'admin-id', Role.ADMIN);
      expect(appointments.findAll).toHaveBeenCalledWith(expect.objectContaining({ order: 'asc' }));
    });

    it('para mirar el historial se pide al revés, y el repositorio lo recibe', async () => {
      await service().findAll({ order: 'desc' }, 'admin-id', Role.ADMIN);
      expect(appointments.findAll).toHaveBeenCalledWith(expect.objectContaining({ order: 'desc' }));
    });

    it('el texto de búsqueda llega al repositorio: filtrar es trabajo de la base, no de la página', async () => {
      await service().findAll({ q: '  perez  ' }, 'admin-id', Role.ADMIN);
      expect(appointments.findAll).toHaveBeenCalledWith(expect.objectContaining({ q: 'perez' }));
    });

    it('una búsqueda en blanco no es una búsqueda', async () => {
      await service().findAll({ q: '   ' }, 'admin-id', Role.ADMIN);
      expect(appointments.findAll).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
    });

    it('filtra por doctor cuando rol es DOCTOR', async () => {
      doctors.findByUserId.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await service().findAll({}, 'u1', Role.DOCTOR);
      expect(appointments.findAll).toHaveBeenCalledWith(expect.objectContaining({ doctorId: 'd1' }));
    });

    it('admin ve todo sin filtro forzado', async () => {
      await service().findAll({}, 'admin-id', Role.ADMIN);
      expect(appointments.findAll).toHaveBeenCalledWith(expect.not.objectContaining({ patientId: expect.anything() }));
    });

    it('interpreta from/to como días completos en hora del hospital', async () => {
      await service().findAll({ from: '2026-09-01', to: '2026-09-30' }, 'admin-id', Role.ADMIN);
      const call = appointments.findAll.mock.calls[0][0];
      expect(call.from.toISOString()).toBe('2026-09-01T03:00:00.000Z');
      expect(call.to.toISOString()).toBe('2026-10-01T02:59:59.999Z');
    });

    it('respeta from/to cuando llegan como instantes completos', async () => {
      await service().findAll({ from: '2026-09-01T12:00:00Z', to: '2026-09-01T18:00:00Z' }, 'admin-id', Role.ADMIN);
      const call = appointments.findAll.mock.calls[0][0];
      expect(call.from.toISOString()).toBe('2026-09-01T12:00:00.000Z');
      expect(call.to.toISOString()).toBe('2026-09-01T18:00:00.000Z');
    });

    it('lanza 404 si doctor no tiene perfil', async () => {
      await expect(service().findAll({}, 'u-no-profile', Role.DOCTOR)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('enriquecimiento de listados', () => {
    const withNames = () => {
      const doc = new Doctor('d1', 'u1', 's1', 'MP-1'); doc.user = { id: 'u1', email: 'doc@t.com', name: 'Dra. House' }; doc.specialty = { id: 's1', name: 'Cardiología' };
      doctors.findByIds.mockResolvedValue([doc]);
      patients.findByIds.mockResolvedValue([new Patient('p1', 'Ana Pérez', 'ana@t.com')]);
    };

    it('findAll incluye doctor (nombre, especialidad, matrícula) y paciente (nombre) en una sola carga batch', async () => {
      withNames();
      appointments.findAll.mockResolvedValue([[new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.PENDING), new Appointment('a2', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.PENDING)], 2]);
      const result = await service().findAll({}, 'admin-id', Role.ADMIN);
      expect(result.data[0].doctor).toEqual({ id: 'd1', licenseNumber: 'MP-1', user: { id: 'u1', email: 'doc@t.com', name: 'Dra. House' }, specialty: { id: 's1', name: 'Cardiología' } });
      expect(result.data[0].patient).toEqual({ id: 'p1', name: 'Ana Pérez', email: 'ana@t.com' });
      expect(doctors.findByIds).toHaveBeenCalledTimes(1);
      expect(doctors.findByIds).toHaveBeenCalledWith(['d1']);
      expect(patients.findByIds).toHaveBeenCalledWith(['p1']);
    });

    it('findOne incluye doctor y paciente', async () => {
      withNames();
      appointments.findById.mockResolvedValue(new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.PENDING));
      const result = await service().findOne('a1', admin);
      expect(result.doctor?.user?.name).toBe('Dra. House');
      expect(result.patient?.name).toBe('Ana Pérez');
    });

    it('tolera referencias huérfanas sin romper', async () => {
      appointments.findAll.mockResolvedValue([[new Appointment('a1', 'd-gone', 'p-gone', 's1', new Date(), 30, AppointmentStatus.PENDING)], 1]);
      const result = await service().findAll({}, 'admin-id', Role.ADMIN);
      expect(result.data[0].doctor).toBeUndefined();
      expect(result.data[0].patient).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('lanza 404 si no existe', async () => {
      await expect(service().findOne('missing', admin)).rejects.toMatchObject({ status: 404 });
    });

    it('retorna turno existente', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.PENDING);
      appointments.findById.mockResolvedValue(a);
      await expect(service().findOne('a1', admin)).resolves.toMatchObject({ id: 'a1' });
    });
  });

  describe('confirm', () => {
    it('lanza 404 si turno no existe', async () => {
      await expect(service().confirm('missing', admin)).rejects.toMatchObject({ status: 404 });
    });

    it('confirma turno pendiente', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.PENDING);
      appointments.findById.mockResolvedValue(a);
      const result = await service().confirm('a1', admin);
      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    });

    it('rechaza confirmar turno no pendiente', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.CONFIRMED);
      appointments.findById.mockResolvedValue(a);
      await expect(service().confirm('a1', admin)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('cancel', () => {
    it('lanza 404 si turno no existe', async () => {
      await expect(service().cancel('missing', {}, admin)).rejects.toMatchObject({ status: 404 });
    });

    it('cancela turno con más de 24h de anticipación', async () => {
      const futureDate = new Date(now.getTime() + 25 * 3600000);
      const a = new Appointment('a1', 'd1', 'p1', 's1', futureDate, 30, AppointmentStatus.PENDING);
      appointments.findById.mockResolvedValue(a);
      const result = await service().cancel('a1', { reason: 'Personal' }, admin);
      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(result.cancellationReason).toBe('Personal');
    });

    it('rechaza cancelar con menos de 24h', async () => {
      const soonDate = new Date(now.getTime() + 23 * 3600000);
      const a = new Appointment('a1', 'd1', 'p1', 's1', soonDate, 30, AppointmentStatus.PENDING);
      appointments.findById.mockResolvedValue(a);
      await expect(service().cancel('a1', {}, admin)).rejects.toMatchObject({ status: 400, code: 'CANCELLATION_TOO_LATE' });
    });

    it('rechaza cancelar turno ya cancelado', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.CANCELLED);
      appointments.findById.mockResolvedValue(a);
      await expect(service().cancel('a1', {}, admin)).rejects.toMatchObject({ status: 400 });
    });

    it('rechaza cancelar turno completado', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.COMPLETED);
      appointments.findById.mockResolvedValue(a);
      await expect(service().cancel('a1', {}, admin)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('complete', () => {
    it('lanza 404 si turno no existe', async () => {
      await expect(service().complete('missing', {}, admin)).rejects.toMatchObject({ status: 404 });
    });

    it('completa turno confirmado', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.CONFIRMED);
      appointments.findById.mockResolvedValue(a);
      const result = await service().complete('a1', {}, admin);
      expect(result.status).toBe(AppointmentStatus.COMPLETED);
    });

    it('rechaza completar turno no confirmado', async () => {
      const a = new Appointment('a1', 'd1', 'p1', 's1', new Date(), 30, AppointmentStatus.PENDING);
      appointments.findById.mockResolvedValue(a);
      await expect(service().complete('a1', {}, admin)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('ownership por rol', () => {
    const docMe = { sub: 'u-doc-me', role: Role.DOCTOR };
    const appt = () => new Appointment('a1', 'd-me', 'p-me', 's1', new Date('2026-09-07T13:00:00Z'), 30, AppointmentStatus.PENDING);
    const setup = () => {
      appointments.findById.mockResolvedValue(appt());
      appointments.update.mockResolvedValue(undefined);
      doctors.findByUserId.mockImplementation(async (u: string) => u === 'u-doc-me' ? new Doctor('d-me', 'u-doc-me', 's1', 'MP-1') : u === 'u-doc-other' ? new Doctor('d-other', 'u-doc-other', 's1', 'MP-2') : undefined);
    };

    it('findOne: el médico del turno puede verlo', async () => {
      setup();
      await expect(service().findOne('a1', docMe)).resolves.toMatchObject({ id: 'a1' });
    });

    it('findOne: otro médico recibe 403', async () => {
      setup();
      await expect(service().findOne('a1', { sub: 'u-doc-other', role: Role.DOCTOR })).rejects.toMatchObject({ status: 403 });
    });

    it('confirm/complete/reschedule: otro médico recibe 403', async () => {
      setup();
      const other = { sub: 'u-doc-other', role: Role.DOCTOR };
      await expect(service().confirm('a1', other)).rejects.toMatchObject({ status: 403 });
      await expect(service().complete('a1', {}, other)).rejects.toMatchObject({ status: 403 });
      await expect(service().reschedule('a1', { dateTime: '2026-09-08T10:00:00Z' }, other)).rejects.toMatchObject({ status: 403 });
      expect(appointments.update).not.toHaveBeenCalled();
    });

    it('create: un médico solo puede crear turnos en su propia agenda', async () => {
      setupValidCreate();
      setup();
      doctors.findById.mockResolvedValue(new Doctor('d-other', 'u-doc-other', 's1', 'MP-2'));
      await expect(service().create({ doctorId: 'd-other', patientId: 'p1', dateTime: '2026-09-07T13:00:00Z' }, docMe)).rejects.toMatchObject({ status: 403 });
    });
  });
});
