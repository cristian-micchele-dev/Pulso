jest.mock('fs', () => ({ createReadStream: jest.fn(() => ({ pipe: jest.fn() })) }));

import { MedicalReportController } from './medical-report.controller';

describe('MedicalReportController', () => {
  const service: any = {
    upload: jest.fn().mockResolvedValue({ id: 'r1' }),
    uploadForPatient: jest.fn().mockResolvedValue({ id: 'r1' }),
    findByAppointment: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 'r1', mimeType: 'application/pdf', originalName: 'x.pdf' }),
    readFile: jest.fn().mockResolvedValue({
      contenido: Buffer.from('%PDF'),
      report: { id: 'r1', mimeType: 'application/pdf', originalName: 'x.pdf' },
    }),
    findByPatient: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new MedicalReportController(service);
  const actor = { sub: 'u1', role: 'DOCTOR' };
  const file = { originalname: 'x.pdf' } as any;
  const req = { user: actor, file } as any;

  beforeEach(() => jest.clearAllMocks());

  it('upload y uploadForPatient pasan el userId y el archivo', async () => {
    await controller.upload('a1', { title: 't' }, req);
    expect(service.upload).toHaveBeenCalledWith('u1', 'a1', { title: 't' }, file);
    await controller.uploadForPatient('p1', { title: 't' }, req);
    expect(service.uploadForPatient).toHaveBeenCalledWith('u1', 'p1', { title: 't' }, file);
  });

  it('las lecturas pasan el actor completo al service', async () => {
    await controller.findByAppointment('a1', {} as any, req);
    expect(service.findByAppointment).toHaveBeenCalledWith('a1', actor);
    await controller.findOne('r1', req);
    expect(service.findOne).toHaveBeenCalledWith('r1', actor);
    await controller.findByPatient('p1', 1, 10, req);
    expect(service.findByPatient).toHaveBeenCalledWith('p1', 1, 10, actor);
  });

  it('download pide el archivo con el actor, que es quien decide el permiso', async () => {
    const res = { set: jest.fn() } as any;
    await controller.download('r1', req, res);
    // Una sola llamada y no dos: antes autorizaba en findOne y otra vez en
    // getFilePath. El permiso lo verifica readFile, antes de leer nada.
    expect(service.readFile).toHaveBeenCalledWith('r1', actor);
    expect(service.findOne).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf' }));
  });

  it('remove pasa el userId', async () => {
    await controller.remove('r1', req);
    expect(service.delete).toHaveBeenCalledWith('r1', 'u1');
  });
});
