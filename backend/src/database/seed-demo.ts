import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'crypto';

/**
 * Clínica de muestra, para el demo y para las capturas del README.
 *
 * Los nombres son inventados A PROPÓSITO y se nota: en un sistema cuya tesis es
 * el cuidado de la historia clínica, mostrar capturas con nombres que parecen
 * reales es incoherente con lo que el proyecto predica.
 *
 * Idempotente: se reconoce por el email de los usuarios y el prefijo del correo
 * de los pacientes, así que correrlo dos veces no duplica nada.
 */

const PASSWORD_DEMO = 'demo pulso 2026';
const MARCA = '@demo.pulso';

const ESPECIALIDADES = ['Cardiología', 'Traumatología', 'Dermatología'];

const MEDICOS = [
  { nombre: 'Dra. Valeria Sosa',    email: `valeria.sosa${MARCA}`,  matricula: 'MP-10001', especialidad: 'Cardiología' },
  { nombre: 'Dr. Ramiro Alcorta',   email: `ramiro.alcorta${MARCA}`, matricula: 'MP-10002', especialidad: 'Traumatología' },
  { nombre: 'Dra. Ingrid Vallejos', email: `ingrid.vallejos${MARCA}`, matricula: 'MP-10003', especialidad: 'Dermatología' },
];

const PACIENTES = [
  'Aurelia Quiroga', 'Baltasar Iriarte', 'Celina Nadal', 'Damián Ferreyra',
  'Elsa Bugarín', 'Facundo Oleiro', 'Greta Salvatierra', 'Horacio Pizarro',
  'Irina Bordón', 'Julián Casaubón', 'Karina Melgarejo', 'Lautaro Vidueiro',
];

/** Lunes a viernes, mañana y tarde: dos bloques por día, como promete el README. */
const FRANJAS = [
  { start: '08:00', end: '12:00' },
  { start: '16:00', end: '20:00' },
];

async function main() {
  const { default: dataSource } = await import('./data-source');
  const { Argon2Hasher } = await import('../shared/infra/crypto/services');

  await dataSource.initialize();
  const hasher = new Argon2Hasher();
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  try {
    const hash = await hasher.hash(PASSWORD_DEMO);

    // ── Especialidades ────────────────────────────────────────────────────
    const especialidadPorNombre = new Map<string, string>();
    for (const nombre of ESPECIALIDADES) {
      const [existente] = await q('SELECT id FROM specialties WHERE name = $1', [nombre]);
      const id = existente?.id ?? randomUUID();
      if (!existente) await q('INSERT INTO specialties (id, name) VALUES ($1, $2)', [id, nombre]);
      especialidadPorNombre.set(nombre, id);
    }

    // ── Secretaría ────────────────────────────────────────────────────────
    const emailSecretaria = `marta.recepcion${MARCA}`;
    const [secretaria] = await q('SELECT id FROM users WHERE email = $1', [emailSecretaria]);
    if (!secretaria) {
      await q(`INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'SECRETARY')`,
        [randomUUID(), emailSecretaria, 'Marta Recepción', hash]);
    }

    // ── Médicos, con perfil y disponibilidad ──────────────────────────────
    const doctorIds: string[] = [];
    for (const medico of MEDICOS) {
      let [usuario] = await q('SELECT id FROM users WHERE email = $1', [medico.email]);
      if (!usuario) {
        const userId = randomUUID();
        await q(`INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'DOCTOR')`,
          [userId, medico.email, medico.nombre, hash]);
        usuario = { id: userId };
      }

      let [doctor] = await q('SELECT id FROM doctors WHERE user_id = $1', [usuario.id]);
      if (!doctor) {
        const doctorId = randomUUID();
        await q('INSERT INTO doctors (id, user_id, specialty_id, license_number) VALUES ($1, $2, $3, $4)',
          [doctorId, usuario.id, especialidadPorNombre.get(medico.especialidad), medico.matricula]);
        doctor = { id: doctorId };

        for (let dia = 1; dia <= 5; dia++) {
          for (const franja of FRANJAS) {
            await q(`INSERT INTO availabilities (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
                     VALUES ($1, $2, $3, $4, $5, 30)`,
              [randomUUID(), doctor.id, dia, franja.start, franja.end]);
          }
        }
      }
      doctorIds.push(doctor.id);
    }

    // ── Pacientes ─────────────────────────────────────────────────────────
    const pacienteIds: string[] = [];
    for (const [i, nombre] of PACIENTES.entries()) {
      const email = `paciente${i + 1}${MARCA}`;
      let [paciente] = await q('SELECT id FROM patients WHERE email = $1', [email]);
      if (!paciente) {
        const id = randomUUID();
        await q(`INSERT INTO patients (id, name, email, phone, insurance_number)
                 VALUES ($1, $2, $3, $4, $5)`,
          [id, nombre, email, `11-4${String(1000 + i).padStart(4, '0')}-${String(2000 + i)}`, `OSDE ${430000 + i}`]);
        paciente = { id };
      }
      pacienteIds.push(paciente.id);
    }

    // ── Turnos: pasados completados, próximos confirmados y pendientes ────
    const [{ n: yaHay }] = await q(
      `SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ANY($1)`, [doctorIds]);

    let creados = 0;
    if (yaHay === 0) {
      const hoy = new Date();
      const alas = (diasDesdeHoy: number, hora: number) => {
        const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + diasDesdeHoy, hora, 0, 0, 0);
        // Los fines de semana no hay agenda: se corre al lunes.
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return d;
      };

      const plan: { dias: number; hora: number; estado: string }[] = [
        { dias: -21, hora: 9,  estado: 'COMPLETED' },
        { dias: -14, hora: 10, estado: 'COMPLETED' },
        { dias: -10, hora: 17, estado: 'COMPLETED' },
        { dias: -7,  hora: 11, estado: 'CANCELLED' },
        { dias: -3,  hora: 16, estado: 'COMPLETED' },
        { dias: 1,   hora: 9,  estado: 'CONFIRMED' },
        { dias: 1,   hora: 17, estado: 'PENDING' },
        { dias: 2,   hora: 10, estado: 'CONFIRMED' },
        { dias: 3,   hora: 11, estado: 'PENDING' },
        { dias: 5,   hora: 16, estado: 'CONFIRMED' },
        { dias: 8,   hora: 9,  estado: 'PENDING' },
        { dias: 12,  hora: 18, estado: 'CONFIRMED' },
      ];

      for (const [i, turno] of plan.entries()) {
        const doctorId = doctorIds[i % doctorIds.length];
        const [{ nextval }] = await q(`SELECT nextval('appointment_code_seq')`);
        const [{ specialty_id }] = await q('SELECT specialty_id FROM doctors WHERE id = $1', [doctorId]);
        await q(`INSERT INTO appointments (id, code, doctor_id, patient_id, specialty_id, date_time, duration_minutes, status, diagnosis)
                 VALUES ($1, $2, $3, $4, $5, $6, 30, $7, $8)`,
          [
            randomUUID(), `TM-${String(nextval).padStart(5, '0')}`, doctorId,
            pacienteIds[i % pacienteIds.length], specialty_id, alas(turno.dias, turno.hora), turno.estado,
            turno.estado === 'COMPLETED' ? 'Control de rutina sin hallazgos.' : null,
          ]);
        creados++;
      }
    }

    console.log(`Clínica de muestra lista.
  especialidades : ${ESPECIALIDADES.length}
  médicos        : ${MEDICOS.length} (lunes a viernes, 08-12 y 16-20)
  pacientes      : ${PACIENTES.length}
  turnos         : ${creados > 0 ? creados : `${yaHay} ya existían, no se tocaron`}

Para entrar, con cualquiera de estos y la contraseña "${PASSWORD_DEMO}":
  ${emailSecretaria}   (secretaría)
${MEDICOS.map((m) => `  ${m.email}   (${m.especialidad})`).join('\n')}

El ADMIN se crea aparte con: npm run seed:admin`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) void main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
