jest.mock('fs/promises', () => ({ writeFile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('fs', () => ({ mkdirSync: jest.fn(), unlinkSync: jest.fn() }));

import { MedicalReportService } from './medical-report.service';
import { MedicalReport } from '../domain/medical-report';
import { Appointment } from '../../appointments/domain/appointment';
import { AppointmentStatus } from '../../appointments/domain/appointment-status.enum';
import { Doctor } from '../../doctors/domain/doctor';
import { DoctorNotFoundError } from '../../doctors/domain/doctor-not-found.exception';
import { ForbiddenError } from '../../../shared/domain/errors';
import { Role } from '../../users/domain/user';

describe('MedicalReportService', () => {
  const doctor = new Doctor('doc-1', 'user-doc-1', 'spec-1', 'LIC-1', null);
  const otherDoctor = new Doctor('doc-2', 'user-doc-2', 'spec-1', 'LIC-2', null);
  const appointment = new Appointment('a1', 'doc-1', 'p1', 'spec-1', new Date('2026-09-07T10:00:00Z'), 30, AppointmentStatus.COMPLETED);
  const file = { originalname: 'informe.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF-1.7 contenido') } as Express.Multer.File;
  const dto = { title: 'Informe' };

  const reports: any = { save: jest.fn(async (r: unknown) => r), findById: jest.fn(), delete: jest.fn(), findByAppointmentId: jest.fn(), findByPatientId: jest.fn() };
  const appointments: any = { findById: jest.fn().mockResolvedValue(appointment) };
  const patients: any = { findById: jest.fn().mockResolvedValue({ id: 'p1', userId: 'user-p1' }) };
  const doctors: any = { findByUserId: jest.fn().mockResolvedValue(doctor) };
  const access: any = { assertCanRead: jest.fn().mockResolvedValue(undefined) };
  // Doble del puerto de archivos: el servicio ya no toca el disco.
  const archivos: any = { guardar: jest.fn(), leer: jest.fn().mockResolvedValue(Buffer.from('pdf')), borrar: jest.fn() };
  const service = new MedicalReportService(reports, appointments, patients, doctors, access, archivos);
  const actor = { sub: 'u-x', role: Role.DOCTOR };

  beforeEach(() => jest.clearAllMocks());

  describe('upload', () => {
    it('resuelve el médico por userId y guarda el informe con doctor.id', async () => {
      const result = await service.upload('user-doc-1', 'a1', dto, file);
      expect(doctors.findByUserId).toHaveBeenCalledWith('user-doc-1');
      expect(result.doctorId).toBe('doc-1');
    });

    it('rechaza si el usuario no tiene perfil de médico', async () => {
      doctors.findByUserId.mockResolvedValueOnce(undefined);
      await expect(service.upload('user-x', 'a1', dto, file)).rejects.toBeInstanceOf(DoctorNotFoundError);
    });

    it('rechaza si el turno es de otro médico', async () => {
      doctors.findByUserId.mockResolvedValueOnce(otherDoctor);
      await expect(service.upload('user-doc-2', 'a1', dto, file)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('qué se acepta como informe', () => {
    it('rechaza un archivo cuyos bytes no son PDF ni imagen, aunque se declare application/pdf', async () => {
      const disguised = { ...file, buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32)]) } as Express.Multer.File;
      await expect(service.upload('user-doc-1', 'a1', dto, disguised)).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_FILE' });
      expect(reports.save).not.toHaveBeenCalled();
    });

    it('guarda el tipo real del archivo, no el que declaró el cliente', async () => {
      const png = { ...file, mimetype: 'application/pdf', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]) } as Express.Multer.File;
      const result = await service.upload('user-doc-1', 'a1', dto, png);
      expect(result.mimeType).toBe('image/png');
      expect(result.fileName).toMatch(/\.png$/);
    });
  });

  describe('uploadForPatient', () => {
    it('guarda el informe con doctor.id, no con el userId', async () => {
      const result = await service.uploadForPatient('user-doc-1', 'p1', dto, file);
      expect(result.doctorId).toBe('doc-1');
    });

    it('exige la misma relación de tratamiento que la lectura: sin turno con el paciente, 403 y no escribe', async () => {
      access.assertCanRead.mockRejectedValueOnce(new ForbiddenError());
      await expect(service.uploadForPatient('user-doc-1', 'p9', dto, file)).rejects.toBeInstanceOf(ForbiddenError);
      expect(access.assertCanRead).toHaveBeenCalledWith({ sub: 'user-doc-1', role: Role.DOCTOR }, 'p9');
      expect(reports.save).not.toHaveBeenCalled();
    });
  });

  describe('lecturas pasan por la política de acceso a historia clínica', () => {
    const report = new MedicalReport('r1', 'a1', 'doc-1', 'p1', 'Informe', null, 'f.pdf', 'informe.pdf', 'application/pdf', 10);

    it('findOne y readFile consultan la política con el paciente del informe', async () => {
      reports.findById.mockResolvedValue(report);
      await service.findOne('r1', actor);
      await service.readFile('r1', actor);
      expect(access.assertCanRead).toHaveBeenCalledTimes(2);
      expect(access.assertCanRead).toHaveBeenCalledWith(actor, 'p1');
    });

    it('findByAppointment consulta la política con el paciente del turno', async () => {
      reports.findByAppointmentId.mockResolvedValueOnce([report]);
      await service.findByAppointment('a1', actor);
      expect(access.assertCanRead).toHaveBeenCalledWith(actor, 'p1');
    });

    it('findByPatient consulta la política y propaga el 403', async () => {
      access.assertCanRead.mockRejectedValueOnce(new ForbiddenError());
      await expect(service.findByPatient('p1', 1, 10, actor)).rejects.toBeInstanceOf(ForbiddenError);
      expect(reports.findByPatientId).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const report = new MedicalReport('r1', 'a1', 'doc-1', 'p1', 'Informe', null, 'f.pdf', 'informe.pdf', 'application/pdf', 10);

    it('permite borrar al médico dueño del informe', async () => {
      reports.findById.mockResolvedValueOnce(report);
      await service.delete('r1', 'user-doc-1');
      expect(reports.delete).toHaveBeenCalledWith('r1');
    });

    it('rechaza borrar un informe de otro médico', async () => {
      reports.findById.mockResolvedValueOnce(report);
      doctors.findByUserId.mockResolvedValueOnce(otherDoctor);
      await expect(service.delete('r1', 'user-doc-2')).rejects.toBeInstanceOf(ForbiddenError);
      expect(reports.delete).not.toHaveBeenCalled();
    });
  });
});
