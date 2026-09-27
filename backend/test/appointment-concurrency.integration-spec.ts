import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppointmentOrmEntity } from '../src/modules/appointments/adapters/persistence/appointment.entity';
import { TypeOrmAppointmentRepository } from '../src/modules/appointments/adapters/persistence/typeorm-appointment.repository';
import { Appointment } from '../src/modules/appointments/domain/appointment';
import { AppointmentStatus } from '../src/modules/appointments/domain/appointment-status.enum';
import { TimeSlotUnavailableError } from '../src/modules/appointments/domain/exceptions';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

/**
 * Lo que sólo se rompe cuando dos personas usan el sistema a la vez.
 *
 * Nada de esto lo puede ver un test con mocks: son carreras entre transacciones
 * reales contra la misma tabla.
 */
describeDatabase('Reservar en simultáneo (PostgreSQL)', () => {
  let dataSource: DataSource;
  let repo: TypeOrmAppointmentRepository;

  const tag = `cnc-${Date.now()}`;
  const specialtyId = randomUUID();
  const userId = randomUUID();
  const doctorId = randomUUID();
  const patientIds: string[] = [];

  const nuevoTurno = (code: string, patientId: string, cuando: Date) =>
    new Appointment(randomUUID(), doctorId, patientId, specialtyId, cuando, 30,
      AppointmentStatus.PENDING, null, null, new Date(), code);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres', url: databaseUrl, entities: [AppointmentOrmEntity],
      migrations: ['src/database/migrations/*.ts'],
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    repo = new TypeOrmAppointmentRepository(dataSource.getRepository(AppointmentOrmEntity));

    await dataSource.query('INSERT INTO specialties (id, name) VALUES ($1, $2)', [specialtyId, `Concurrencia ${tag}`]);
    await dataSource.query(`INSERT INTO users (id,email,name,password_hash,role) VALUES ($1,$2,$3,'x','DOCTOR')`,
      [userId, `c.${tag}@mail.com`, `Doc ${tag}`]);
    await dataSource.query('INSERT INTO doctors (id,user_id,specialty_id,license_number) VALUES ($1,$2,$3,$4)',
      [doctorId, userId, specialtyId, `MP-${tag}`]);
    for (let i = 0; i < 12; i++) {
      const id = randomUUID();
      patientIds.push(id);
      await dataSource.query('INSERT INTO patients (id,name) VALUES ($1,$2)', [id, `Pac ${i} ${tag}`]);
    }
  }, 60_000);

  afterAll(async () => {
    await dataSource.query('DELETE FROM appointments WHERE doctor_id = $1', [doctorId]);
    await dataSource.query('DELETE FROM patients WHERE id = ANY($1)', [patientIds]);
    await dataSource.query('DELETE FROM doctors WHERE id = $1', [doctorId]);
    await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    await dataSource.query('DELETE FROM specialties WHERE id = $1', [specialtyId]);
    if (dataSource?.isInitialized) await dataSource.destroy();
  }, 30_000);

  it('doce códigos pedidos a la vez son doce códigos distintos', async () => {
    const codigos = await Promise.all(Array.from({ length: 12 }, () => repo.nextCode()));
    expect(new Set(codigos).size).toBe(12);
    expect(codigos.every((c) => /^TM-\d{5}$/.test(c))).toBe(true);
  });

  it('perder la carrera por un horario da un error de negocio, no un 500', async () => {
    const cuando = new Date(Date.UTC(2027, 5, 1, 14, 0, 0));
    await repo.save(nuevoTurno(await repo.nextCode(), patientIds[0], cuando));

    // El segundo llega tarde: la validación previa ya pasó, y el constraint lo frena.
    await expect(repo.save(nuevoTurno(await repo.nextCode(), patientIds[1], cuando)))
      .rejects.toBeInstanceOf(TimeSlotUnavailableError);
  });

  it('doce reservas simultáneas del mismo horario dejan UNA sola, y el resto se rechaza con sentido', async () => {
    const cuando = new Date(Date.UTC(2027, 5, 2, 14, 0, 0));
    const intentos = await Promise.allSettled(
      patientIds.map(async (p) => repo.save(nuevoTurno(await repo.nextCode(), p, cuando))),
    );

    const ok = intentos.filter((r) => r.status === 'fulfilled');
    const rechazos = intentos.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rechazos.every((r) => r.reason instanceof TimeSlotUnavailableError)).toBe(true);

    const [, total] = await repo.findAll({ doctorId, from: cuando, to: cuando });
    expect(total).toBe(1);
  });
});
