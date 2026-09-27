import configuration from './configuration';

describe('configuration', () => {
  it('retorna valores por defecto', () => {
    const config = configuration();
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('test');
    expect(config.jwt.accessTtl).toBe('15m');
    expect(config.jwt.refreshTtl).toBe('7d');
    expect(config.jwt.issuer).toBe('turno-medicos');
    expect(config.corsOrigin).toBe('http://localhost:3000');
    expect(config.swaggerEnabled).toBe(true);
  });

  it('lee variables de entorno cuando existen', () => {
    const prev = process.env.PORT;
    process.env.PORT = '4000';
    const config = configuration();
    expect(config.port).toBe(4000);
    process.env.PORT = prev;
  });
});

describe('límite de pedidos configurable', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('trae valores por defecto sensatos si nadie los define', async () => {
    delete process.env.THROTTLE_LIMIT;
    delete process.env.THROTTLE_TTL;
    const config = (await import('./configuration')).default();
    expect(config.throttle).toEqual({ ttl: 60000, limit: 100 });
  });

  it('se puede subir por entorno: detrás de un balanceador todo el tráfico llega de una sola IP', async () => {
    process.env.THROTTLE_LIMIT = '5000';
    process.env.THROTTLE_TTL = '30000';
    const config = (await import('./configuration')).default();
    expect(config.throttle).toEqual({ ttl: 30000, limit: 5000 });
  });
});

describe('pool de conexiones a la base', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('por defecto 10, que es lo que ya venía usando el driver', async () => {
    delete process.env.DB_POOL_MAX;
    const config = (await import('./configuration')).default();
    expect(config.dbPoolMax).toBe(10);
  });

  it('se puede bajar por entorno: N instancias por el pool no pueden superar el max_connections del servidor', async () => {
    process.env.DB_POOL_MAX = '5';
    const config = (await import('./configuration')).default();
    expect(config.dbPoolMax).toBe(5);
  });
});
