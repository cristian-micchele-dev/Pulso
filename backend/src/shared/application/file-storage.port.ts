/**
 * Dónde se guardan los archivos que sube la gente.
 *
 * Existe porque los servicios de aplicación estaban llamando a `fs` directo, y
 * eso no es una impureza teórica: el disco de un servicio en la nube es efímero
 * —se borra en cada despliegue y en cada reinicio—, así que un informe subido
 * desaparecía al rato mientras su fila en la base seguía apuntándolo.
 *
 * Con el puerto, cambiar disco local por almacenamiento remoto es un adaptador
 * nuevo y una variable de entorno. Sin él, había que meter mano adentro de la
 * lógica de negocio para arreglar un problema de infraestructura.
 *
 * Las claves son `carpeta` + `nombre` y no una ruta armada: una ruta es un
 * detalle del disco, y en un almacén de objetos no significa lo mismo.
 */
export const ALMACEN_DE_ARCHIVOS = Symbol('ALMACEN_DE_ARCHIVOS');

export interface AlmacenDeArchivos {
  /** Guarda el contenido. Si la clave ya existía, la reemplaza. */
  guardar(carpeta: string, nombre: string, contenido: Buffer, tipo: string): Promise<void>;

  /** Devuelve el contenido. Lanza `ArchivoNoEncontradoError` si no está. */
  leer(carpeta: string, nombre: string): Promise<Buffer>;

  /**
   * Borra el archivo. Es IDEMPOTENTE a propósito: que ya no esté no es un error.
   * Lo que importa es que después de llamar, no exista.
   */
  borrar(carpeta: string, nombre: string): Promise<void>;
}

/** Carpetas en uso. Nombrarlas evita que cada módulo invente la suya. */
export const CARPETA_INFORMES = 'reports';
export const CARPETA_AVATARES = 'avatars';
