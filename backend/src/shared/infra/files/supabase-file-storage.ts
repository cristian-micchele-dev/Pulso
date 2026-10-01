import { Injectable } from '@nestjs/common';
import { AlmacenDeArchivos } from '../../application/file-storage.port';
import { ArchivoNoEncontradoError } from '../../domain/file-not-found.exception';

/**
 * Almacén sobre Supabase Storage.
 *
 * Sin SDK: son tres llamadas HTTP y Node trae `fetch`. Agregar una dependencia
 * de cientos de kilobytes para tres `fetch` es cargar un peso que después hay
 * que mantener y actualizar.
 *
 * Usa la clave `service_role`, que SALTEA las reglas de acceso de Supabase.
 * Eso es deliberado: quién puede ver cada informe lo decide el dominio —roles,
 * y la política de acceso a la historia clínica—, no una regla duplicada en la
 * base. Pero implica que esta clave no puede filtrarse: vive sólo en el
 * servidor y el bucket tiene que ser PRIVADO, o cualquiera con la URL lee
 * informes médicos.
 */
@Injectable()
export class AlmacenSupabase implements AlmacenDeArchivos {
  constructor(
    private readonly url: string,
    private readonly clave: string,
    private readonly bucket: string,
  ) {}

  private endpoint(carpeta: string, nombre: string): string {
    return `${this.url}/storage/v1/object/${this.bucket}/${carpeta}/${encodeURIComponent(nombre)}`;
  }

  private get cabeceras(): Record<string, string> {
    return { Authorization: `Bearer ${this.clave}`, apikey: this.clave };
  }

  async guardar(carpeta: string, nombre: string, contenido: Buffer, tipo: string): Promise<void> {
    const r = await fetch(this.endpoint(carpeta, nombre), {
      method: 'POST',
      headers: {
        ...this.cabeceras,
        'Content-Type': tipo,
        // Sin esto, subir dos veces la misma clave da 409 en vez de reemplazar.
        'x-upsert': 'true',
      },
      body: new Uint8Array(contenido),
    });
    if (!r.ok) {
      throw new Error(`No se pudo guardar ${carpeta}/${nombre}: ${r.status} ${await r.text()}`);
    }
  }

  async leer(carpeta: string, nombre: string): Promise<Buffer> {
    const r = await fetch(this.endpoint(carpeta, nombre), { headers: this.cabeceras });
    if (r.status === 404) throw new ArchivoNoEncontradoError(`${carpeta}/${nombre}`);
    if (!r.ok) {
      throw new Error(`No se pudo leer ${carpeta}/${nombre}: ${r.status} ${await r.text()}`);
    }
    return Buffer.from(await r.arrayBuffer());
  }

  async borrar(carpeta: string, nombre: string): Promise<void> {
    const r = await fetch(this.endpoint(carpeta, nombre), {
      method: 'DELETE',
      headers: this.cabeceras,
    });
    // Idempotente como el puerto promete: un 404 ya cumple lo que se pedía.
    if (!r.ok && r.status !== 404) {
      throw new Error(`No se pudo borrar ${carpeta}/${nombre}: ${r.status} ${await r.text()}`);
    }
  }
}
