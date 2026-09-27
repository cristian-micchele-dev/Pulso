import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Los números que contestan "¿esto está funcionando?".
 *
 * Los logs cuentan qué pasó en UN pedido; las métricas cuentan cómo viene el
 * conjunto. Son preguntas distintas: el log te sirve cuando ya sabés que algo
 * falló, la métrica es la que te avisa.
 *
 * Registro propio en vez del global de prom-client: el global es estado
 * compartido de módulo, y dos tests que registren la misma métrica chocarían
 * entre sí.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  /** Segundos. Los cortes están donde duele: medio segundo ya se nota al usarlo. */
  private readonly duracion = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Cuánto tarda un pedido, en segundos',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly pedidos = new Counter({
    name: 'http_requests_total',
    help: 'Pedidos atendidos',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  /** Hechos del dominio que valen una alerta aunque nada devuelva error. */
  private readonly eventos = new Counter({
    name: 'pulso_events_total',
    help: 'Hechos del negocio que vale la pena vigilar',
    labelNames: ['event'] as const,
    registers: [this.registry],
  });

  constructor() {
    // Memoria, CPU y retraso del event loop: la app se degrada por acá mucho
    // antes de empezar a devolver 500.
    collectDefaultMetrics({ register: this.registry });
  }

  recordRequest(method: string, route: string, status: number, segundos: number): void {
    const labels = { method, route, status: String(status) };
    this.pedidos.inc(labels);
    this.duracion.observe(labels, segundos);
  }

  recordEvent(event: string): void {
    this.eventos.inc({ event });
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
