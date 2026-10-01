import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AlmacenEnDisco } from './disk-file-storage';
import { AlmacenSupabase } from './supabase-file-storage';
import { crearAlmacen } from './file-storage.module';
import { ArchivoNoEncontradoError } from '../../domain/file-not-found.exception';
import { CARPETA_INFORMES } from '../../application/file-storage.port';

describe('AlmacenEnDisco', () => {
  let raiz: string;
  let almacen: AlmacenEnDisco;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'pulso-'));
    almacen = new AlmacenEnDisco(raiz);
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it('devuelve lo mismo que se guardo, byte por byte', async () => {
    const contenido = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await almacen.guardar(CARPETA_INFORMES, 'a.pdf', contenido, 'application/pdf');

    expect(await almacen.leer(CARPETA_INFORMES, 'a.pdf')).toEqual(contenido);
  });

  it('crea la carpeta sola al guardar', async () => {
    // Nadie prepara el terreno antes: el almacen no tiene que exigir que exista
    // un directorio para funcionar.
    await expect(almacen.guardar('carpeta-nueva', 'x.pdf', Buffer.from('hola'), 'application/pdf'))
      .resolves.not.toThrow();
  });

  it('avisa con un error de dominio cuando el archivo no esta', async () => {
    // Es el caso que motivo todo esto: la fila existe y el archivo no.
    await expect(almacen.leer(CARPETA_INFORMES, 'fantasma.pdf'))
      .rejects.toBeInstanceOf(ArchivoNoEncontradoError);
  });

  it('borrar es idempotente: que ya no este no es un error', async () => {
    await almacen.guardar(CARPETA_INFORMES, 'b.pdf', Buffer.from('x'), 'application/pdf');

    await expect(almacen.borrar(CARPETA_INFORMES, 'b.pdf')).resolves.not.toThrow();
    await expect(almacen.borrar(CARPETA_INFORMES, 'b.pdf')).resolves.not.toThrow();
    await expect(almacen.leer(CARPETA_INFORMES, 'b.pdf')).rejects.toBeInstanceOf(ArchivoNoEncontradoError);
  });

  it('reemplaza el contenido si la clave se repite', async () => {
    await almacen.guardar(CARPETA_INFORMES, 'c.pdf', Buffer.from('viejo'), 'application/pdf');
    await almacen.guardar(CARPETA_INFORMES, 'c.pdf', Buffer.from('nuevo'), 'application/pdf');

    expect((await almacen.leer(CARPETA_INFORMES, 'c.pdf')).toString()).toBe('nuevo');
  });
});

describe('AlmacenSupabase', () => {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  let responder: (url: string) => Response;

  beforeEach(() => {
    llamadas.length = 0;
    responder = () => new Response('', { status: 200 });
    globalThis.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init });
      return responder(String(url));
    }) as unknown as typeof fetch;
  });

  const almacen = () => new AlmacenSupabase('https://proyecto.supabase.co', 'clave-secreta', 'pulso');

  it('arma la ruta del objeto con bucket y carpeta', async () => {
    await almacen().guardar(CARPETA_INFORMES, 'a.pdf', Buffer.from('x'), 'application/pdf');

    expect(llamadas[0].url).toBe('https://proyecto.supabase.co/storage/v1/object/pulso/reports/a.pdf');
  });

  it('manda upsert al guardar', async () => {
    await almacen().guardar(CARPETA_INFORMES, 'a.pdf', Buffer.from('x'), 'application/pdf');

    // Sin upsert, subir dos veces la misma clave responde 409 en vez de
    // reemplazar, y el puerto promete que reemplaza.
    expect((llamadas[0].init?.headers as Record<string, string>)['x-upsert']).toBe('true');
  });

  it('traduce el 404 de la API al error de dominio', async () => {
    responder = () => new Response('', { status: 404 });

    await expect(almacen().leer(CARPETA_INFORMES, 'x.pdf'))
      .rejects.toBeInstanceOf(ArchivoNoEncontradoError);
  });

  it('borrar aguanta el 404, igual que el adaptador de disco', async () => {
    responder = () => new Response('', { status: 404 });

    // Los dos adaptadores tienen que cumplir la MISMA promesa, o cambiar de
    // almacen rompe cosas sutilmente.
    await expect(almacen().borrar(CARPETA_INFORMES, 'x.pdf')).resolves.not.toThrow();
  });

  it('un error que no sea 404 si se propaga', async () => {
    responder = () => new Response('sin permisos', { status: 403 });

    // Un 403 significa clave o bucket mal configurados: tragarlo dejaria la
    // aplicacion perdiendo archivos en silencio.
    await expect(almacen().leer(CARPETA_INFORMES, 'x.pdf')).rejects.toThrow(/403/);
  });
});

describe('crearAlmacen', () => {
  it('sin configurar, usa el disco', () => {
    expect(crearAlmacen({})).toBeInstanceOf(AlmacenEnDisco);
  });

  it('con supabase y sus variables, usa supabase', () => {
    const almacen = crearAlmacen({
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://proyecto.supabase.co',
      SUPABASE_SERVICE_KEY: 'clave',
    });
    expect(almacen).toBeInstanceOf(AlmacenSupabase);
  });

  it('falla al arrancar si pide supabase y faltan las variables', () => {
    // NO cae al disco en silencio: eso dejaria el servicio aceptando informes
    // para perderlos en el siguiente reinicio, que es el bug original.
    expect(() => crearAlmacen({ STORAGE_DRIVER: 'supabase' })).toThrow(/SUPABASE_URL/);
  });

  it('falla con un driver que no existe en vez de adivinar', () => {
    expect(() => crearAlmacen({ STORAGE_DRIVER: 's3' })).toThrow(/desconocido/);
  });
});
