import { Global, Logger, Module } from '@nestjs/common';
import { ALMACEN_DE_ARCHIVOS, AlmacenDeArchivos } from '../../application/file-storage.port';
import { AlmacenEnDisco } from './disk-file-storage';
import { AlmacenSupabase } from './supabase-file-storage';

/**
 * Elige dónde se guardan los archivos.
 *
 * `STORAGE_DRIVER` lo dice EXPLÍCITAMENTE en vez de deducirlo de `NODE_ENV`,
 * por la misma razón que la política de cookies: describe la infraestructura
 * disponible, no el entorno. Hay despliegues de producción con disco persistente
 * y hay desarrollo contra el almacén remoto; atarlo a `NODE_ENV` obliga a mentir
 * sobre el entorno para conseguir el almacén que uno quiere.
 *
 * Si pide `supabase` y falta alguna variable, FALLA AL ARRANCAR. Caer en silencio
 * al disco sería peor: el servicio levantaría, aceptaría informes y los perdería
 * al primer reinicio, que es exactamente el problema que vino a resolver esto.
 */
export function crearAlmacen(env: NodeJS.ProcessEnv = process.env): AlmacenDeArchivos {
  const driver = (env.STORAGE_DRIVER ?? 'disk').toLowerCase();

  if (driver === 'supabase') {
    const url = env.SUPABASE_URL;
    const clave = env.SUPABASE_SERVICE_KEY;
    const bucket = env.STORAGE_BUCKET ?? 'pulso';
    if (!url || !clave) {
      throw new Error(
        'STORAGE_DRIVER=supabase necesita SUPABASE_URL y SUPABASE_SERVICE_KEY. ' +
          'Sin eso los archivos se guardarian en un disco efimero y se perderian.',
      );
    }
    return new AlmacenSupabase(url.replace(/\/+$/, ''), clave, bucket);
  }

  if (driver !== 'disk') {
    throw new Error(`STORAGE_DRIVER desconocido: "${driver}". Valores validos: disk, supabase.`);
  }

  return new AlmacenEnDisco();
}

@Global()
@Module({
  providers: [
    {
      provide: ALMACEN_DE_ARCHIVOS,
      useFactory: () => {
        const almacen = crearAlmacen();
        new Logger('FileStorage').log(`Archivos en ${almacen.constructor.name}`);
        return almacen;
      },
    },
  ],
  exports: [ALMACEN_DE_ARCHIVOS],
})
export class FileStorageModule {}
