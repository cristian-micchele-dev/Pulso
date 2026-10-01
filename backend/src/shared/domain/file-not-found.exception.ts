import { DomainError } from './errors';

/**
 * El registro existe pero su archivo no está en el almacén.
 *
 * No es lo mismo que "el informe no existe": acá la fila está en la base y lo
 * que falta es el contenido. Pasa cuando el almacén perdió el archivo —el caso
 * que motivó todo esto— o cuando alguien lo borró por fuera de la aplicación.
 * Se distingue para que el mensaje no mienta y para que el log permita
 * diferenciar un pedido a un id inventado de una inconsistencia real.
 */
export class ArchivoNoEncontradoError extends DomainError {
  constructor(clave: string) {
    super('FILE_NOT_FOUND', `El archivo ${clave} ya no está disponible`, 404);
  }
}
