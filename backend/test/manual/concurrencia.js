/**
 * Prueba de concurrencia, no de velocidad.
 *
 * Dos escenarios que sólo aparecen con gente usando el sistema al mismo tiempo:
 *   A) varias secretarias reservando HORARIOS DISTINTOS a la vez
 *   B) varias secretarias peleando por el MISMO horario del mismo médico
 *
 * En los dos, lo que se mira es: ¿cuántos 201, cuántos rechazos de negocio
 * (4xx), y cuántos 500? Un 500 acá significa que la app no supo manejar algo que
 * va a pasar todos los días.
 *
 * Crea todo lo que necesita y lo borra al final.
 */
require('dotenv/config');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const argon2 = require('argon2');

const BASE = 'http://127.0.0.1:3099/api/v1';
const PASS = 'colina ventana 41';
const CONCURRENCIA = 12;

const sello = Date.now();
const ids = {
  specialty: randomUUID(), userDoc: randomUUID(), doctor: randomUUID(),
  userSec: randomUUID(), availability: randomUUID(), patients: [],
};
const emailSec = `sec.${sello}@carga.test`;

const post = async (path, token, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const texto = await res.text();
  let cuerpo = {};
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = { raw: texto.slice(0, 120) }; }
  return { status: res.status, code: cuerpo.code, detail: cuerpo.detail, appointmentCode: cuerpo.code && cuerpo.id ? undefined : cuerpo.code };
};

const resumen = (resultados) => {
  const porEstado = {};
  for (const r of resultados) porEstado[r.status] = (porEstado[r.status] ?? 0) + 1;
  return porEstado;
};

(async () => {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });

  await db.query('INSERT INTO specialties (id, name) VALUES ($1, $2)', [ids.specialty, `Carga ${sello}`]);
  await db.query(`INSERT INTO users (id,email,name,password_hash,role) VALUES ($1,$2,'Doc Carga',$3,'DOCTOR')`,
    [ids.userDoc, `doc.${sello}@carga.test`, hash]);
  await db.query('INSERT INTO doctors (id,user_id,specialty_id,license_number) VALUES ($1,$2,$3,$4)',
    [ids.doctor, ids.userDoc, ids.specialty, `MP-${sello}`]);
  await db.query(`INSERT INTO users (id,email,name,password_hash,role) VALUES ($1,$2,'Secre Carga',$3,'SECRETARY')`,
    [ids.userSec, emailSec, hash]);
  // Disponible todos los días, todo el día: el objetivo es la concurrencia, no la agenda.
  for (let dia = 0; dia < 7; dia++) {
    const id = randomUUID();
    await db.query(`INSERT INTO availabilities (id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
                    VALUES ($1,$2,$3,'00:00','23:59',30)`, [id, ids.doctor, dia]);
    ids.availability = id;
  }
  for (let i = 0; i < CONCURRENCIA; i++) {
    const id = randomUUID();
    ids.patients.push(id);
    await db.query('INSERT INTO patients (id,name) VALUES ($1,$2)', [id, `Paciente carga ${i} ${sello}`]);
  }

  try {
    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailSec, password: PASS }),
    });
    const { accessToken } = await login.json();
    if (!accessToken) throw new Error('no se pudo loguear la secretaria');

    // ── A) horarios DISTINTOS, todos a la vez ────────────────────────────────
    const base = new Date(Date.UTC(2027, 0, 11, 13, 0, 0)); // un lunes, lejos
    const distintos = await Promise.all(
      Array.from({ length: CONCURRENCIA }, (_, i) => post('/appointments', accessToken, {
        doctorId: ids.doctor,
        patientId: ids.patients[i],
        dateTime: new Date(base.getTime() + i * 30 * 60_000).toISOString(),
      })),
    );
    console.log(`\nA) ${CONCURRENCIA} reservas simultáneas en horarios DISTINTOS`);
    console.log('   por estado:', JSON.stringify(resumen(distintos)));
    const errores500A = distintos.filter((r) => r.status >= 500);
    if (errores500A.length) console.log(`   ⚠️  ${errores500A.length} respuestas 5xx — ejemplo: ${errores500A[0].detail}`);

    // ── B) todas por el MISMO horario ────────────────────────────────────────
    const mismo = new Date(Date.UTC(2027, 0, 12, 13, 0, 0)).toISOString();
    const pelea = await Promise.all(
      Array.from({ length: CONCURRENCIA }, (_, i) => post('/appointments', accessToken, {
        doctorId: ids.doctor, patientId: ids.patients[i], dateTime: mismo,
      })),
    );
    console.log(`\nB) ${CONCURRENCIA} reservas simultáneas por el MISMO horario`);
    console.log('   por estado:', JSON.stringify(resumen(pelea)));
    const errores500B = pelea.filter((r) => r.status >= 500);
    if (errores500B.length) console.log(`   ⚠️  ${errores500B.length} respuestas 5xx — ejemplo: ${errores500B[0].detail}`);

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1 AND date_time = $2::timestamptz',
      [ids.doctor, mismo]);
    console.log(`   turnos que quedaron en la base para ese horario: ${rows[0].n}  (tiene que ser 1)`);

    const { rows: codigos } = await db.query(
      'SELECT count(*)::int AS total, count(DISTINCT code)::int AS distintos FROM appointments WHERE doctor_id = $1',
      [ids.doctor]);
    console.log(`\nCódigos generados: ${codigos[0].total} turnos, ${codigos[0].distintos} códigos distintos`);
  } finally {
    await db.query('DELETE FROM notifications WHERE user_id = ANY($1)', [[ids.userDoc, ids.userSec]]);
    await db.query('DELETE FROM appointments WHERE doctor_id = $1', [ids.doctor]);
    await db.query('DELETE FROM availabilities WHERE doctor_id = $1', [ids.doctor]);
    await db.query('DELETE FROM patients WHERE id = ANY($1)', [ids.patients]);
    await db.query('DELETE FROM doctors WHERE id = $1', [ids.doctor]);
    await db.query('DELETE FROM auth_sessions WHERE user_id = ANY($1)', [[ids.userDoc, ids.userSec]]);
    await db.query('DELETE FROM users WHERE id = ANY($1)', [[ids.userDoc, ids.userSec]]);
    await db.query('DELETE FROM specialties WHERE id = $1', [ids.specialty]);
    await db.end();
    console.log('\ndatos de prueba borrados');
  }
})().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
