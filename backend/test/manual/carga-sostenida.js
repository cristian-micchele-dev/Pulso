/**
 * Carga sostenida sobre una ruta de lectura, subiendo la concurrencia.
 *
 * ADVERTENCIA DE INTERPRETACIÓN: la base está en Supabase, del otro lado de
 * internet. Los milisegundos absolutos miden sobre todo la red, no la app. Lo
 * que SÍ es válido leer acá:
 *   - la tasa de error: ¿aparecen 500 cuando la concurrencia supera el pool?
 *   - la FORMA de la latencia: si p95 se dispara contra p50, hay cola
 *   - el throughput relativo entre escalones
 *
 * El pool de TypeORM está en el default del driver pg: 10 conexiones.
 */
require('dotenv/config');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const argon2 = require('argon2');

const BASE = 'http://127.0.0.1:3099/api/v1';
const PASS = 'colina ventana 41';
const ESCALONES = [5, 20, 50];
const SEGUNDOS = 8;

const sello = Date.now();
const userSec = randomUUID();
const emailSec = `carga.${sello}@load.test`;

const percentil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))];

async function escalon(token, concurrencia) {
  const latencias = [];
  const estados = {};
  const hasta = Date.now() + SEGUNDOS * 1000;

  const trabajador = async () => {
    while (Date.now() < hasta) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}/appointments?limit=20`, { headers: { authorization: `Bearer ${token}` } });
        await res.arrayBuffer();
        estados[res.status] = (estados[res.status] ?? 0) + 1;
      } catch (e) {
        estados['red'] = (estados['red'] ?? 0) + 1;
      }
      latencias.push(performance.now() - t0);
    }
  };

  await Promise.all(Array.from({ length: concurrencia }, trabajador));
  latencias.sort((a, b) => a - b);
  return {
    concurrencia,
    pedidos: latencias.length,
    rps: (latencias.length / SEGUNDOS).toFixed(1),
    p50: percentil(latencias, 0.5).toFixed(0),
    p95: percentil(latencias, 0.95).toFixed(0),
    p99: percentil(latencias, 0.99).toFixed(0),
    estados,
  };
}

(async () => {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  await db.query(`INSERT INTO users (id,email,name,password_hash,role) VALUES ($1,$2,'Carga',$3,'SECRETARY')`,
    [userSec, emailSec, await argon2.hash(PASS, { type: argon2.argon2id })]);

  try {
    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailSec, password: PASS }),
    });
    const { accessToken } = await login.json();
    if (!accessToken) throw new Error('no se pudo loguear');

    await escalon(accessToken, 3); // calentamiento, no se reporta

    console.log('\nconc.  pedidos    rps     p50     p95     p99   estados');
    for (const c of ESCALONES) {
      const r = await escalon(accessToken, c);
      console.log(
        `${String(r.concurrencia).padStart(4)}  ${String(r.pedidos).padStart(7)}  ${String(r.rps).padStart(5)}  ` +
        `${String(r.p50 + 'ms').padStart(6)}  ${String(r.p95 + 'ms').padStart(6)}  ${String(r.p99 + 'ms').padStart(6)}   ` +
        JSON.stringify(r.estados));

      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`);
      console.log(`      conexiones abiertas contra la base durante el escalón: ${rows[0].n}`);
    }
  } finally {
    await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [userSec]);
    await db.query('DELETE FROM users WHERE id = $1', [userSec]);
    await db.end();
    console.log('\nusuario de prueba borrado');
  }
})().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
