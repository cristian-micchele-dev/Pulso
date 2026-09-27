import { Controller, Get, Headers, NotFoundException, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { MetricsService } from './metrics.service';

/** Comparación en tiempo constante: comparar con `===` filtra el token a fuerza de medir. */
function tokenIgual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Las métricas no son públicas.
 *
 * Cuentan las rutas que existen, cuántos usuarios hay conectados, cuánta memoria
 * usa el proceso y cuántos logins fallan: un mapa de la casa por dentro y una
 * forma cómoda de saber si un ataque está funcionando.
 *
 * Apagado por defecto: sin `METRICS_TOKEN` configurado el endpoint devuelve 404,
 * y ni siquiera delata que existe. Prometheus manda el token como Bearer.
 */
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async scrape(@Headers('authorization') authorization: string | undefined, @Res() res: Response): Promise<void> {
    const esperado = this.config.get<string>('metricsToken');
    if (!esperado) throw new NotFoundException();

    const recibido = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!tokenIgual(recibido, esperado)) throw new UnauthorizedException();

    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.scrape());
  }
}
