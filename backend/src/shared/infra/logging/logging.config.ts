import type { Params } from 'nestjs-pino';
import type { Request } from 'express';
import { REQUEST_ID_HEADER } from '../http/request-id';

/**
 * Qué NUNCA sale en un log, por más que alguien lo pase sin querer.
 *
 * Un log se copia, se manda por chat y se guarda en un servicio de terceros. Un
 * token que aparece ahí es un token regalado, y a diferencia de una contraseña
 * nadie se entera de que se filtró.
 */
const SECRETOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/** Ruido: se responden cada pocos segundos y no dicen nada cuando salen bien. */
const SILENCIOSAS = ['/api/v1/health/live', '/api/v1/health/ready'];

export function loggingConfig(): Params {
  const produccion = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (produccion ? 'info' : 'debug'),

      // JSON en producción, porque lo lee una máquina. Legible en desarrollo,
      // porque lo leés vos.
      transport: produccion ? undefined : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },

      redact: { paths: SECRETOS, censor: '[oculto]' },

      // El mismo id que ya viaja en el header y en el cuerpo del error: buscar
      // por él tiene que traer TODO lo que pasó en ese pedido.
      genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) ?? '',

      // Quién lo hizo, no qué mandó. El cuerpo del pedido puede traer un
      // diagnóstico, y la historia clínica no va a los logs.
      customProps: (req) => {
        const actor = (req as Request & { user?: { sub?: string; role?: string } }).user;
        return actor?.sub ? { userId: actor.sub, role: actor.role } : {};
      },

      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },

      autoLogging: {
        ignore: (req) => SILENCIOSAS.includes((req.url ?? '').split('?')[0]),
      },
    },
  };
}
