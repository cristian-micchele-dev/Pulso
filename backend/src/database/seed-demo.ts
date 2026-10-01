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

/**
 * Recetas de muestra, una por especialidad.
 *
 * Sin esto la demo tiene turnos pero no historia clínica, y las dos pantallas
 * que mejor cuentan el producto —la receta en PDF y la historia del paciente—
 * se ven vacías justo cuando alguien las abre por primera vez.
 */
const RECETAS: Record<string, { medications: { name: string; dosage: string; frequency: string; duration: string }[]; instructions: string }> = {
  'Cardiología': {
    medications: [
      { name: 'Enalapril', dosage: '10 mg', frequency: 'Cada 12 horas', duration: '30 días' },
      { name: 'Aspirina', dosage: '100 mg', frequency: 'Una vez por día', duration: '30 días' },
    ],
    instructions: 'Tomar con las comidas. Controlar la presión dos veces por día y anotar los valores.',
  },
  'Traumatología': {
    medications: [
      { name: 'Ibuprofeno', dosage: '400 mg', frequency: 'Cada 8 horas', duration: '7 días' },
    ],
    instructions: 'Reposo relativo. Hielo 15 minutos, tres veces por día, sobre la zona.',
  },
  'Dermatología': {
    medications: [
      { name: 'Hidrocortisona crema', dosage: '1%', frequency: 'Dos veces por día', duration: '14 días' },
    ],
    instructions: 'Aplicar sobre piel limpia y seca. Evitar la exposición al sol en la zona tratada.',
  },
};

/**
 * Un PDF mínimo pero VÁLIDO, armado a mano.
 *
 * El backend no confía en el tipo que declara el cliente: olfatea los primeros
 * bytes (`sniffFileType`). Un archivo de mentira con el nombre terminado en
 * `.pdf` sería rechazado, igual que lo sería en producción. Así que la muestra
 * tiene que ser un PDF de verdad, aunque sea el más chico posible.
 */
export function pdfDeMuestra(titulo: string): Buffer {
  const texto = `BT /F1 14 Tf 60 740 Td (${titulo.replace(/[()\\]/g, '')}) Tj ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let cuerpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(cuerpo.length);
    cuerpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  const inicioTabla = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) cuerpo += `${String(o).padStart(10, '0')} 00000 n \n`;
  cuerpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioTabla}\n%%EOF\n`;

  return Buffer.from(cuerpo, 'latin1');
}

const INFORMES = [
  'Electrocardiograma de reposo',
  'Radiografía de rodilla derecha',
  'Dermatoscopia de lesión en antebrazo',
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

    // ── Historia clínica: una receta y un informe por turno completado ────
    //
    // Cuelgan de turnos COMPLETED y no de cualquiera, porque es la misma regla
    // que aplica la aplicación: un informe documenta una consulta que ya pasó.
    // Sembrar datos que la interfaz no dejaría crear haría que la demo muestre
    // estados imposibles.
    const completados = await q(
      `SELECT a.id, a.doctor_id, a.patient_id, s.name AS especialidad
         FROM appointments a
         JOIN specialties s ON s.id = a.specialty_id
        WHERE a.status = 'COMPLETED' AND a.doctor_id = ANY($1)
        ORDER BY a.date_time`,
      [doctorIds],
    );

    const [{ n: yaHayRecetas }] = await q(
      `SELECT count(*)::int AS n FROM prescriptions WHERE doctor_id = ANY($1)`, [doctorIds]);

    let recetas = 0, informes = 0;
    let almacen: { guardar: (c: string, n: string, b: Buffer, t: string) => Promise<void>; constructor: { name: string } } | null = null;
    if (yaHayRecetas === 0) {
      // El mismo puerto que usa la aplicación: con STORAGE_DRIVER=supabase los
      // archivos van al bucket, y sin él al disco local. El seed no decide
      // dónde se guardan, igual que no lo decide ningún servicio.
      const { crearAlmacen } = await import('../shared/infra/files/file-storage.module');
      const { CARPETA_INFORMES } = await import('../shared/application/file-storage.port');
      almacen = crearAlmacen();

      for (const [i, turno] of completados.entries()) {
        const receta = RECETAS[turno.especialidad];
        if (receta) {
          await q(
            `INSERT INTO prescriptions (id, appointment_id, doctor_id, patient_id, medications, instructions)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
            [randomUUID(), turno.id, turno.doctor_id, turno.patient_id,
             JSON.stringify(receta.medications), receta.instructions],
          );
          recetas++;
        }

        const titulo = INFORMES[i % INFORMES.length];
        const contenido = pdfDeMuestra(titulo);
        const nombre = `${randomUUID()}.pdf`;
        await almacen.guardar(CARPETA_INFORMES, nombre, contenido, 'application/pdf');
        await q(
          `INSERT INTO medical_reports (id, appointment_id, doctor_id, patient_id, title, description, file_name, original_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'application/pdf', $9)`,
          [randomUUID(), turno.id, turno.doctor_id, turno.patient_id, titulo,
           'Estudio de muestra generado por el seed.', nombre,
           `${titulo.toLowerCase().replace(/\s+/g, '-')}.pdf`, contenido.length],
        );
        informes++;
      }
    }

    console.log(`Clínica de muestra lista.
  especialidades : ${ESPECIALIDADES.length}
  médicos        : ${MEDICOS.length} (lunes a viernes, 08-12 y 16-20)
  pacientes      : ${PACIENTES.length}
  turnos         : ${creados > 0 ? creados : `${yaHay} ya existían, no se tocaron`}
  recetas        : ${recetas > 0 ? recetas : `${yaHayRecetas} ya existían, no se tocaron`}
  informes       : ${informes > 0 ? informes : 'no se tocaron'}${almacen ? ` (en ${almacen.constructor.name})` : ''}${almacen?.constructor.name === 'AlmacenEnDisco' ? `

  ATENCION: los archivos quedaron en el DISCO LOCAL.
  Si la base a la que apunta DATABASE_URL es la de produccion, las filas
  van a apuntar a archivos que el servidor no tiene y las descargas van a
  fallar. Defini STORAGE_DRIVER, SUPABASE_URL y SUPABASE_SERVICE_KEY y
  volve a correrlo.` : ''}

Para entrar, con cualquiera de estos y la contraseña "${PASSWORD_DEMO}":
  ${emailSecretaria}   (secretaría)
${MEDICOS.map((m) => `  ${m.email}   (${m.especialidad})`).join('\n')}

El ADMIN se crea aparte con: npm run seed:admin`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) void main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
