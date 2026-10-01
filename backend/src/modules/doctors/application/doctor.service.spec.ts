import { DoctorService } from './doctor.service';
import { Doctor } from '../domain/doctor';
import { Availability } from '../domain/availability';
import { Role, User } from '../../users/domain/user';
import { Specialty } from '../../specialties/domain/specialty';

describe('DoctorService', () => {
  const doctors: any = { findById: jest.fn(), findByUserId: jest.fn(), findByLicense: jest.fn(), findAll: jest.fn(), save: jest.fn(), update: jest.fn() };
  const availabilities: any = { findByDoctor: jest.fn(), findByDoctorAndDay: jest.fn(), save: jest.fn(), deleteByDoctor: jest.fn() };
  const scheduleBlocks: any = { findByDoctor: jest.fn(), findOverlapping: jest.fn(), save: jest.fn(), delete: jest.fn(), findById: jest.fn() };
  const specialties: any = { findById: jest.fn() };
  const users: any = { findById: jest.fn(), findByEmail: jest.fn(), save: jest.fn(), update: jest.fn() };

  const admin = { sub: 'admin-1', role: Role.ADMIN };
  // Doble del puerto de archivos: el servicio ya no toca el disco.
  const archivos: any = { guardar: jest.fn(), leer: jest.fn().mockResolvedValue(Buffer.from('img')), borrar: jest.fn() };
  const service = () => new DoctorService(doctors, availabilities, scheduleBlocks, specialties, users, archivos);

  beforeEach(() => {
    jest.clearAllMocks();
    doctors.findById.mockResolvedValue(undefined);
    doctors.findByUserId.mockResolvedValue(undefined);
    doctors.findByLicense.mockResolvedValue(undefined);
    doctors.findAll.mockResolvedValue([[], 0]);
    availabilities.findByDoctor.mockResolvedValue([]);
    availabilities.findByDoctorAndDay.mockResolvedValue([]);
    scheduleBlocks.findByDoctor.mockResolvedValue([]);
    scheduleBlocks.findOverlapping.mockResolvedValue([]);
    scheduleBlocks.findById.mockResolvedValue(undefined);
    specialties.findById.mockResolvedValue(undefined);
    users.findById.mockResolvedValue(undefined);
  });

  describe('create', () => {
    it('crea médico cuando usuario es DOCTOR y validaciones pasan', async () => {
      users.findById.mockResolvedValue(new User('u1', 'doc@test.com', '', 'hash', Role.DOCTOR));
      specialties.findById.mockResolvedValue(new Specialty('s1', 'Cardiología'));
      doctors.save.mockImplementation(async (d: Doctor) => d);
      const result = await service().create({ userId: 'u1', specialtyId: 's1', licenseNumber: 'MP-123' });
      expect(result.userId).toBe('u1');
      expect(result.specialtyId).toBe('s1');
    });

    it('rechaza si usuario no tiene rol DOCTOR', async () => {
      users.findById.mockResolvedValue(new User('u1', 'admin@test.com', '', 'hash', Role.ADMIN));
      await expect(service().create({ userId: 'u1', specialtyId: 's1', licenseNumber: 'MP-123' })).rejects.toMatchObject({ status: 409 });
    });

    it('rechaza si usuario ya tiene perfil de médico', async () => {
      users.findById.mockResolvedValue(new User('u1', 'doc@test.com', '', 'hash', Role.DOCTOR));
      doctors.findByUserId.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-999'));
      await expect(service().create({ userId: 'u1', specialtyId: 's1', licenseNumber: 'MP-123' })).rejects.toMatchObject({ status: 409 });
    });

    it('rechaza matrícula duplicada', async () => {
      users.findById.mockResolvedValue(new User('u1', 'doc@test.com', '', 'hash', Role.DOCTOR));
      doctors.findByLicense.mockResolvedValue(new Doctor('d2', 'u2', 's1', 'MP-123'));
      await expect(service().create({ userId: 'u1', specialtyId: 's1', licenseNumber: 'MP-123' })).rejects.toMatchObject({ status: 409 });
    });

    it('rechaza si especialidad no existe', async () => {
      users.findById.mockResolvedValue(new User('u1', 'doc@test.com', '', 'hash', Role.DOCTOR));
      await expect(service().create({ userId: 'u1', specialtyId: 'bad', licenseNumber: 'MP-123' })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('findAll', () => {
    it('retorna médicos activos', async () => {
      doctors.findAll.mockResolvedValue([[new Doctor('d1', 'u1', 's1', 'MP-1')], 1]);
      const result = await service().findAll();
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(doctors.findAll).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    });

    it('filtra por especialidad', async () => {
      await service().findAll({ specialtyId: 's1' });
      expect(doctors.findAll).toHaveBeenCalledWith(expect.objectContaining({ specialtyId: 's1', active: true }));
    });
  });

  describe('findOne / findByUserId', () => {
    it('retorna médico existente', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().findOne('d1')).resolves.toMatchObject({ id: 'd1' });
    });

    it('lanza 404 si no existe', async () => {
      await expect(service().findOne('missing')).rejects.toMatchObject({ status: 404 });
    });

    it('busca por userId', async () => {
      doctors.findByUserId.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().findByUserId('u1')).resolves.toMatchObject({ userId: 'u1' });
    });
  });

  describe('avatar', () => {
    const doctorActor = { sub: 'u1', role: Role.DOCTOR };
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const png = { mimetype: 'image/png', originalname: 'yo.png', buffer: Buffer.concat([PNG_MAGIC, Buffer.alloc(8)]), size: 16 } as any;

    it('guarda la foto propia en el almacen y persiste el nombre de archivo', async () => {
      const d = new Doctor('d1', 'u1', 's1', 'MP-1');
      doctors.findById.mockResolvedValue(d);
      doctors.findByUserId.mockResolvedValue(d);
      const result = await service().setAvatar('d1', png, doctorActor);
      expect(result.avatarFile).toMatch(/^[0-9a-f-]{36}.png$/);
      expect(archivos.guardar).toHaveBeenCalledWith('avatars', result.avatarFile, png.buffer, 'image/png');
      expect(doctors.update).toHaveBeenCalledWith(expect.objectContaining({ avatarFile: result.avatarFile }));
    });

    it('al reemplazar la foto borra el archivo anterior', async () => {
      const d = new Doctor('d1', 'u1', 's1', 'MP-1', null, true, new Date(), 'vieja.png');
      doctors.findById.mockResolvedValue(d);
      await service().setAvatar('d1', png, admin);
      expect(archivos.borrar).toHaveBeenCalledWith('avatars', 'vieja.png');
    });

    it('un ejecutable disfrazado de PNG no entra: mandan los bytes, no el mimetype', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      const exe = { ...png, buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32)]) };
      await expect(service().setAvatar('d1', exe, admin)).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_IMAGE' });
      expect(archivos.guardar).not.toHaveBeenCalled();
    });

    it('rechaza archivos que no son imagen', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().setAvatar('d1', { ...png, buffer: Buffer.from('%PDF-1.7 no soy una imagen') }, admin)).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_IMAGE' });
      expect(archivos.guardar).not.toHaveBeenCalled();
    });

    it('un médico no puede cambiar la foto de otro', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d2', 'u2', 's1', 'MP-2'));
      doctors.findByUserId.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().setAvatar('d2', png, doctorActor)).rejects.toMatchObject({ status: 403 });
    });

    it('getAvatar devuelve contenido y mime, o 404 si no hay foto', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1', null, true, new Date(), 'abc.webp'));
      const file = await service().getAvatar('d1');
      expect(archivos.leer).toHaveBeenCalledWith('avatars', 'abc.webp');
      expect(file.contenido).toEqual(Buffer.from('img'));
      expect(file.mimeType).toBe('image/webp');
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().getAvatar('d1')).rejects.toMatchObject({ status: 404, code: 'AVATAR_NOT_FOUND' });
    });

    it('removeAvatar borra el archivo y limpia el campo', async () => {
      const d = new Doctor('d1', 'u1', 's1', 'MP-1', null, true, new Date(), 'abc.jpg');
      doctors.findById.mockResolvedValue(d);
      doctors.findByUserId.mockResolvedValue(d);
      await service().removeAvatar('d1', doctorActor);
      expect(archivos.borrar).toHaveBeenCalledWith('avatars', 'abc.jpg');
      expect(doctors.update).toHaveBeenCalledWith(expect.objectContaining({ avatarFile: null }));
    });
  });

  describe('update', () => {
    it('actualiza campos parcialmente', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      const result = await service().update('d1', { phone: '1155667788' }, admin);
      expect(result.phone).toBe('1155667788');
      expect(doctors.update).toHaveBeenCalled();
    });

    it('valida especialidad al cambiarla', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      await expect(service().update('d1', { specialtyId: 'bad' }, admin)).rejects.toMatchObject({ status: 404 });
    });

    it('rechaza matrícula duplicada de otro médico', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      doctors.findByLicense.mockResolvedValue(new Doctor('d2', 'u2', 's1', 'MP-999'));
      await expect(service().update('d1', { licenseNumber: 'MP-999' }, admin)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('setAvailability', () => {
    it('reemplaza disponibilidad completa', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      availabilities.save.mockImplementation(async (a: Availability) => a);
      const result = await service().setAvailability('d1', { slots: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }] }, admin);
      expect(availabilities.deleteByDoctor).toHaveBeenCalledWith('d1');
      expect(result).toHaveLength(1);
      expect(result[0].dayOfWeek).toBe(1);
    });

    it('lanza 404 si médico no existe', async () => {
      await expect(service().setAvailability('missing', { slots: [] }, admin)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getAvailability', () => {
    it('retorna toda la disponibilidad sin fecha', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      availabilities.findByDoctor.mockResolvedValue([new Availability('a1', 'd1', 1, '09:00', '13:00', 30)]);
      const result = await service().getAvailability('d1');
      expect(result).toHaveLength(1);
    });

    it('genera slots para una fecha específica', async () => {
      doctors.findById.mockResolvedValue(new Doctor('d1', 'u1', 's1', 'MP-1'));
      // 2026-09-07 es lunes (dayOfWeek=1)
      availabilities.findByDoctorAndDay.mockResolvedValue([new Availability('a1', 'd1', 1, '09:00', '11:00', 30)]);
      const result = await service().getAvailability('d1', '2026-09-07');
      expect((result[0] as any).slots).toEqual(['09:00', '09:30', '10:00', '10:30']);
    });
  });

  describe('ownership (rol DOCTOR)', () => {
    const me = { sub: 'u-me', role: Role.DOCTOR };
    const setupTwoDoctors = () => {
      doctors.findByUserId.mockResolvedValue(new Doctor('d-me', 'u-me', 's1', 'MP-1'));
      doctors.findById.mockImplementation(async (id: string) => id === 'd-me' ? new Doctor('d-me', 'u-me', 's1', 'MP-1') : id === 'd-other' ? new Doctor('d-other', 'u-other', 's1', 'MP-2') : undefined);
    };

    it('un médico puede editar su propio perfil', async () => {
      setupTwoDoctors();
      await expect(service().update('d-me', { phone: '1' }, me)).resolves.toMatchObject({ id: 'd-me' });
    });

    it('un médico NO puede editar el perfil de otro médico', async () => {
      setupTwoDoctors();
      await expect(service().update('d-other', { phone: '1' }, me)).rejects.toMatchObject({ status: 403 });
      expect(doctors.update).not.toHaveBeenCalled();
    });

    it('un médico NO puede cambiar la disponibilidad de otro médico', async () => {
      setupTwoDoctors();
      await expect(service().setAvailability('d-other', { slots: [] }, me)).rejects.toMatchObject({ status: 403 });
      expect(availabilities.deleteByDoctor).not.toHaveBeenCalled();
    });

    it('un médico NO puede bloquear la agenda de otro médico', async () => {
      setupTwoDoctors();
      await expect(service().addBlock('d-other', { startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-02T00:00:00Z' }, me)).rejects.toMatchObject({ status: 403 });
    });

    it('un médico NO puede borrar bloqueos de otro médico', async () => {
      setupTwoDoctors();
      await expect(service().removeBlock('d-other', 'b1', me)).rejects.toMatchObject({ status: 403 });
      expect(scheduleBlocks.delete).not.toHaveBeenCalled();
    });

    it('un DOCTOR sin perfil recibe 404', async () => {
      await expect(service().update('d-me', { phone: '1' }, me)).rejects.toMatchObject({ status: 404 });
    });
  });
});
