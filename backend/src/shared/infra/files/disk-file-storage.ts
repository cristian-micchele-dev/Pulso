import { Injectable } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { AlmacenDeArchivos } from '../../application/file-storage.port';
import { ArchivoNoEncontradoError } from '../../domain/file-not-found.exception';

/**
 * Almacén en el disco local.
 *
 * Es el adaptador de desarrollo y de los tests: no necesita red, credenciales
 * ni servicios externos, así que levantar el proyecto sigue siendo clonar e
 * iniciar. En un servidor con disco efímero no sirve, y para eso está el
 * adaptador de Supabase.
 */
@Injectable()
export class AlmacenEnDisco implements AlmacenDeArchivos {
  constructor(private readonly raiz = join(process.cwd(), 'uploads')) {}

  private ruta(carpeta: string, nombre: string): string {
    return join(this.raiz, carpeta, nombre);
  }

  /**
   * Recibe `tipo` aunque no lo use: la firma espeja la del puerto. Acortarla
   * compila igual, pero deja dos adaptadores que no se pueden intercambiar sin
   * mirar cuál es cuál, que es justo lo que el puerto vino a evitar.
   */
  async guardar(carpeta: string, nombre: string, contenido: Buffer, _tipo: string): Promise<void> {
    // La carpeta se crea al guardar y no al arrancar: así el almacén no tiene
    // efectos en el disco por el solo hecho de existir, que es lo que hacía
    // que los tests dejaran directorios sueltos.
    await mkdir(join(this.raiz, carpeta), { recursive: true });
    await writeFile(this.ruta(carpeta, nombre), contenido);
  }

  async leer(carpeta: string, nombre: string): Promise<Buffer> {
    try {
      return await readFile(this.ruta(carpeta, nombre));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ArchivoNoEncontradoError(`${carpeta}/${nombre}`);
      }
      throw e;
    }
  }

  async borrar(carpeta: string, nombre: string): Promise<void> {
    // Idempotente: que ya no esté es exactamente el resultado buscado.
    try {
      await unlink(this.ruta(carpeta, nombre));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
