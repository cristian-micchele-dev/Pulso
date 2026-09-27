/**
 * La prueba real del adaptador, por el camino de verdad (el chat):
 *   - el médico abre su socket contra la instancia A (3101)
 *   - la secretaria le manda un mensaje contra la instancia B (3102)
 *   - el evento 'message' tiene que llegarle al socket que está en A
 *
 * Sin adaptador esto falla siempre: `server.to(room).emit()` sólo alcanza a los
 * sockets del propio proceso. Crea dos usuarios descartables y los borra.
 */
require('dotenv/config');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const argon2 = require('argon2');
const { io } = require('socket.io-client');

const A = 'http://127.0.0.1:3101';
const B = 'http://127.0.0.1:3102';
const PASS = 'colina ventana 41';
const sello = Date.now();
const medico = { id: randomUUID(), email: `doc.${sello}@ws.test`, role: 'DOCTOR' };
const secre = { id: randomUUID(), email: `sec.${sello}@ws.test`, role: 'SECRETARY' };

const login = async (base, email) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`login falló en ${base}: ${JSON.stringify(body)}`);
  return body.accessToken;
};

(async () => {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const u of [medico, secre]) {
    await db.query(`INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
      [u.id, u.email, `Probe ${u.role}`, hash, u.role]);
  }

  let socket;
  try {
    const tokenMedico = await login(A, medico.email);
    const tokenSecre = await login(B, secre.email);

    socket = io(A, { auth: { token: tokenMedico }, transports: ['websocket'] });
    await new Promise((ok, fail) => {
      socket.on('connect', ok);
      socket.on('connect_error', (e) => fail(new Error(`socket rechazado por A: ${e.message}`)));
      setTimeout(() => fail(new Error('no conectó a A')), 10_000);
    });
    console.log('médico con socket abierto contra la instancia A (3101)');

    const recibido = new Promise((ok) => socket.on('message', ok));
    await new Promise((r) => setTimeout(r, 2000)); // que B termine de suscribirse al canal

    const res = await fetch(`${B}/api/v1/messages/${medico.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenSecre}` },
      body: JSON.stringify({ body: 'Doctor, llegó el paciente de las 15.' }),
    });
    console.log(`secretaria mandó el mensaje contra la instancia B (HTTP ${res.status})`);
    if (res.status >= 400) throw new Error(await res.text());

    const evento = await Promise.race([
      recibido,
      new Promise((_, fail) => setTimeout(() => fail(new Error('TIMEOUT: el evento NO cruzó de B a A')), 15_000)),
    ]);
    console.log(`\n✅ cruzó: el socket en A recibió "${evento.body}"`);
  } finally {
    if (socket) socket.close();
    const ids = [medico.id, secre.id];
    await db.query('DELETE FROM messages WHERE sender_id = ANY($1) OR recipient_id = ANY($1)', [ids]);
    await db.query('DELETE FROM notifications WHERE user_id = ANY($1)', [ids]);
    await db.query('DELETE FROM auth_sessions WHERE user_id = ANY($1)', [ids]);
    await db.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    await db.end();
    console.log('usuarios de prueba borrados');
  }
})().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
