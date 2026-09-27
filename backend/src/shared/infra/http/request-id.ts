import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Un identificador por pedido, desde que entra hasta que sale.
 *
 * Sirve para una sola cosa, y es la que importa cuando algo se rompe: un médico
 * dice "me falló recién" y con ese id se sigue el rastro de SU pedido entre
 * miles de líneas de log, sin adivinar por horario.
 *
 * Si el cliente trae el suyo se respeta, para poder cruzar el rastro con el de
 * otro servicio o con el del navegador. Si no, se genera acá. Siempre vuelve en
 * la respuesta: un id que el cliente no ve no lo puede reportar.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const entrante = req.headers[REQUEST_ID_HEADER];
  const id = (Array.isArray(entrante) ? entrante[0] : entrante)?.trim() || randomUUID();

  req.headers[REQUEST_ID_HEADER] = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
