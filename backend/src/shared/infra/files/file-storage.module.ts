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
    // El panel de Supabase muestra la URL del API REST, con /rest/v1 pegado al
    // final, y es la que casi todo el mundo copia. Pasada tal cual, el adaptador
    // armaria /rest/v1/storage/v1/object/... y la API responderia 404 sin decir
    // por que. Vale mas no arrancar que perseguir ese 404 en produccion.
    const limpia = url.replace(/\/+$/, '');
    if (new URL(limpia).pathname !== '/') {
      throw new Error(
        `SUPABASE_URL tiene que ser solo el dominio del proyecto, sin ninguna ruta. ` +
          `Recibi "${limpia}"; se esperaba algo como https://<proyecto>.supabase.co`,
      );
    }

    return new AlmacenSupabase(limpia, clave, bucket);
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
