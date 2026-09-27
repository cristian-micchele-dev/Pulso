import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

describe('MetricsInterceptor', () => {
  const metrics = { recordRequest: jest.fn() } as unknown as MetricsService;
  const interceptor = new MetricsInterceptor(metrics);

  const contexto = (tipo = 'http', statusCode = 200) => ({
    getType: () => tipo,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', route: { path: '/turnos/:id' }, originalUrl: '/api/v1/turnos/abc' }),
      getResponse: () => ({ statusCode }),
    }),
  }) as never;

  beforeEach(() => jest.clearAllMocks());

  const correr = (ctx: never, handler: { handle: () => unknown }) =>
    new Promise((ok) => (interceptor.intercept(ctx, handler as never) as never as { subscribe: (o: unknown) => void })
      .subscribe({ next: ok, error: ok, complete: ok }));

  it('anota método, patrón de ruta y estado de un pedido que sale bien', async () => {
    await correr(contexto('http', 201), { handle: () => of({ ok: true }) });
    expect(metrics.recordRequest).toHaveBeenCalledWith('POST', '/turnos/:id', 201, expect.any(Number));
  });

  it('el pedido que FALLA también se cuenta: es justo el que hay que ver en el gráfico', async () => {
    await correr(contexto(), { handle: () => throwError(() => ({ status: 409 })) });
    expect(metrics.recordRequest).toHaveBeenCalledWith('POST', '/turnos/:id', 409, expect.any(Number));
  });

  it('un error sin estado se cuenta como 500, no se pierde', async () => {
    await correr(contexto(), { handle: () => throwError(() => new Error('reventó')) });
    expect(metrics.recordRequest).toHaveBeenCalledWith('POST', '/turnos/:id', 500, expect.any(Number));
  });

  it('lo que no es HTTP no se mide: un socket no tiene ni ruta ni estado', async () => {
    await correr(contexto('ws'), { handle: () => of(null) });
    expect(metrics.recordRequest).not.toHaveBeenCalled();
  });
});
