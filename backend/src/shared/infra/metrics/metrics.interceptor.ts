import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';
import { routeLabel } from './route-label';

/**
 * Mide todos los pedidos HTTP, salgan bien o mal.
 *
 * `tap` con las dos ramas y no `finalize`: un pedido que termina en error
 * también cuenta, y de hecho es el que más importa. El estado se lee de la
 * respuesta ya resuelta, así que el 500 que arma el filtro queda registrado.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const empezo = process.hrtime.bigint();

    const registrar = (estado: number) => {
      const segundos = Number(process.hrtime.bigint() - empezo) / 1e9;
      this.metrics.recordRequest(req.method, routeLabel(req), estado, segundos);
    };

    return next.handle().pipe(tap({
      next: () => registrar(res.statusCode),
      error: (e: { status?: number }) => registrar(e?.status ?? 500),
    }));
  }
}
