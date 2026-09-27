import pino from 'pino';
import { loggingConfig } from './logging.config';

/** Corre un objeto por el redactor real de pino y devuelve lo que se habría escrito. */
const loguear = (objeto: Record<string, unknown>) => {
  const salida: string[] = [];
  const { redact } = loggingConfig().pinoHttp as { redact: pino.redactOptions };
  const logger = pino({ redact }, { write: (linea: string) => salida.push(linea) } as pino.DestinationStream);
  logger.info(objeto, 'pedido');
  return JSON.parse(salida[0]);
};

describe('logging — qué nunca se escribe', () => {
  it('el Authorization no se escribe: un token en un log es un token regalado', () => {
    const linea = loguear({ req: { headers: { authorization: 'Bearer secreto-de-verdad' } } });
    expect(linea.req.headers.authorization).toBe('[oculto]');
    expect(JSON.stringify(linea)).not.toContain('secreto-de-verdad');
  });

  it('las cookies tampoco, ni las que entran ni las que salen', () => {
    const linea = loguear({
      req: { headers: { cookie: 'refresh_token=abc123' } },
      res: { headers: { 'set-cookie': ['refresh_token=xyz789'] } },
    });
    expect(JSON.stringify(linea)).not.toContain('abc123');
    expect(JSON.stringify(linea)).not.toContain('xyz789');
  });

  it('lo que sí sirve se conserva: sin método y ruta el log no dice nada', () => {
    const linea = loguear({ req: { method: 'POST', url: '/api/v1/turnos', headers: { authorization: 'Bearer x' } } });
    expect(linea.req.method).toBe('POST');
    expect(linea.req.url).toBe('/api/v1/turnos');
  });
});

describe('logging — cómo se decide qué nivel y qué se calla', () => {
  const { pinoHttp } = loggingConfig() as {
    pinoHttp: {
      customLogLevel: (req: unknown, res: { statusCode: number }, err?: Error) => string;
      autoLogging: { ignore: (req: { url: string }) => boolean };
      customProps: (req: unknown) => Record<string, unknown>;
    };
  };

  it('un 500 es error, un 400 es aviso, un 200 es rutina', () => {
    expect(pinoHttp.customLogLevel({}, { statusCode: 500 })).toBe('error');
    expect(pinoHttp.customLogLevel({}, { statusCode: 403 })).toBe('warn');
    expect(pinoHttp.customLogLevel({}, { statusCode: 200 })).toBe('info');
  });

  it('los health checks no se loguean: se responden cada pocos segundos y tapan lo que importa', () => {
    expect(pinoHttp.autoLogging.ignore({ url: '/api/v1/health/live' })).toBe(true);
    expect(pinoHttp.autoLogging.ignore({ url: '/api/v1/health/ready?x=1' })).toBe(true);
    expect(pinoHttp.autoLogging.ignore({ url: '/api/v1/turnos' })).toBe(false);
  });

  it('se anota QUIÉN hizo el pedido, nunca qué mandó', () => {
    expect(pinoHttp.customProps({ user: { sub: 'u1', role: 'DOCTOR' } })).toEqual({ userId: 'u1', role: 'DOCTOR' });
    expect(pinoHttp.customProps({})).toEqual({});
  });
});
