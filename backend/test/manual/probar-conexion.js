/**
 * Prueba una cadena de conexión antes de pegarla en un panel de despliegue.
 *
 * Un despliegue en Render tarda varios minutos y, si la cadena está mal, lo
 * único que dice el log es `28P01: password authentication failed`. Esta sonda
 * da la misma respuesta en dos segundos.
 *
 * Y verifica algo que el arranque NO verifica: que el pooler esté en modo
 * SESIÓN. El adaptador de WebSockets reparte los eventos entre instancias con
 * LISTEN/NOTIFY, y en modo transacción pgBouncer devuelve la conexión al pool
 * después de cada transacción: la aplicación levanta igual y las notificaciones
 * en vivo dejan de llegar sin que nada falle de forma visible.
 *
 * NUNCA imprime la cadena ni la contraseña: sólo el usuario, el servidor y qué
 * dio cada prueba. Se puede pegar la salida en cualquier lado sin filtrar nada.
 *
 *   cd backend
 *   DATABASE_URL='...' node test/manual/probar-conexion.js
 *
 * En PowerShell:
 *   $env:DATABASE_URL='...'; node test/manual/probar-conexion.js
 */

const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Ver el encabezado de este archivo.');
  process.exit(1);
}

/** Lo que se puede contar de la cadena sin revelar la contraseña. */
function describir(cadena) {
  try {
    const u = new URL(cadena);
    const esPooler = u.hostname.includes('pooler.supabase.com');
    const modo = !esPooler ? 'conexión directa' : u.port === '6543' ? 'pooler TRANSACCIÓN' : 'pooler SESIÓN';
    return {
      usuario: decodeURIComponent(u.username),
      servidor: `${u.hostname}:${u.port || '5432'}`,
      base: u.pathname.replace('/', ''),
      modo,
      // Un marcador sin reemplazar es la causa más común, y el error del
      // servidor es idéntico al de una contraseña equivocada.
      marcadorSinReemplazar: /\[|%5B/i.test(u.password ?? ''),
      largoDeContrasena: (u.password ?? '').length,
    };
  } catch {
    return null;
  }
}

const info = describir(url);
if (!info) {
  console.error('La cadena no parece una URL válida. Suele ser un carácter sin codificar en la contraseña:');
  console.error('  @ -> %40   # -> %23   / -> %2F   ? -> %3F   % -> %25   : -> %3A');
  process.exit(1);
}

console.log('Cadena recibida');
console.log('  usuario   :', info.usuario);
console.log('  servidor  :', info.servidor);
console.log('  base      :', info.base);
console.log('  modo      :', info.modo);
console.log('  contraseña:', info.largoDeContrasena, 'caracteres');
if (info.marcadorSinReemplazar) {
  console.log('\n  AVISO: la contraseña tiene corchetes. ¿Quedó el [YOUR-PASSWORD] sin reemplazar?');
}
if (info.usuario === 'postgres' && info.modo.startsWith('pooler')) {
  console.log('\n  AVISO: contra el pooler el usuario va como postgres.<ref-del-proyecto>, no "postgres" solo.');
}
console.log();

// Mismo SSL que usa la aplicación en main.ts, para probar lo que de verdad corre.
const cliente = new Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

(async () => {
  try {
    await cliente.connect();
    console.log('1. Autenticación ........ OK');
  } catch (e) {
    console.log('1. Autenticación ........ FALLA');
    console.log('   ', e.code ?? '', e.message);
    if (e.code === '28P01') {
      console.log('\n   Es la contraseña. Revisá, en este orden:');
      console.log('   - que no haya quedado el marcador [YOUR-PASSWORD]');
      console.log('   - que los caracteres raros esten codificados (@ -> %40, etc.)');
      console.log('   - que sea la contraseña de la BASE, no la de la cuenta de Supabase');
    }
    process.exit(1);
  }

  try {
    const { rows } = await cliente.query('select current_user as usuario, current_database() as base');
    console.log('2. Consulta ............. OK  (conectado como', rows[0].usuario + ')');
  } catch (e) {
    console.log('2. Consulta ............. FALLA:', e.message);
  }

  // La prueba que importa: en modo transacción esto falla o no recibe nada.
  try {
    const recibido = new Promise((resolve) => {
      cliente.on('notification', (n) => resolve(n.payload));
      setTimeout(() => resolve(null), 3000);
    });
    await cliente.query('listen sonda_pulso');
    await cliente.query("notify sonda_pulso, 'hola'");
    const payload = await recibido;

    if (payload === 'hola') {
      console.log('3. LISTEN/NOTIFY ........ OK  (los WebSockets entre instancias van a funcionar)');
    } else {
      console.log('3. LISTEN/NOTIFY ........ NO LLEGO LA NOTIFICACION');
      console.log('   Senal de pooler en modo TRANSACCION. Usá el de modo SESION (puerto 5432');
      console.log('   sobre el host pooler) o las notificaciones en vivo no van a andar.');
    }
  } catch (e) {
    console.log('3. LISTEN/NOTIFY ........ FALLA:', e.message);
  }

  await cliente.end();
})();
