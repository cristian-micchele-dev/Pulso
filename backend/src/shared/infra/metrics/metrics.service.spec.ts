import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('cuenta los pedidos por ruta, método y estado', async () => {
    metrics.recordRequest('GET', '/turnos', 200, 0.012);
    metrics.recordRequest('GET', '/turnos', 200, 0.030);
    metrics.recordRequest('GET', '/turnos', 500, 0.500);

    const texto = await metrics.scrape();
    expect(texto).toContain('http_requests_total{method="GET",route="/turnos",status="200"} 2');
    expect(texto).toContain('http_requests_total{method="GET",route="/turnos",status="500"} 1');
  });

  it('mide cuánto tardan, no sólo cuántos son: un endpoint lento no da error', async () => {
    metrics.recordRequest('POST', '/turnos', 201, 0.4);
    const texto = await metrics.scrape();
    expect(texto).toContain('http_request_duration_seconds_bucket');
    expect(texto).toContain('route="/turnos"');
  });

  it('expone las métricas de Node: la memoria y el event loop se caen antes que la app', async () => {
    const texto = await metrics.scrape();
    expect(texto).toContain('nodejs_eventloop_lag_seconds');
    expect(texto).toContain('process_resident_memory_bytes');
  });

  it('los hechos del negocio también se cuentan: un bloqueo de cuenta importa más que un 500', async () => {
    metrics.recordEvent('account_locked');
    metrics.recordEvent('account_locked');
    metrics.recordEvent('appointment_created');

    const texto = await metrics.scrape();
    expect(texto).toContain('pulso_events_total{event="account_locked"} 2');
    expect(texto).toContain('pulso_events_total{event="appointment_created"} 1');
  });

  it('cada instancia tiene su propio registro: dos no se pisan los contadores', async () => {
    const otra = new MetricsService();
    metrics.recordEvent('account_locked');
    expect(await otra.scrape()).not.toContain('pulso_events_total{event="account_locked"}');
  });
});
