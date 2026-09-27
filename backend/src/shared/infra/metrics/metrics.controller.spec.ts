import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('GET /metrics — quién puede mirar por adentro', () => {
  const service = { scrape: jest.fn(async () => '# HELP algo\n'), contentType: 'text/plain' } as unknown as MetricsService;
  const res = () => ({ setHeader: jest.fn(), send: jest.fn() });

  const controller = (token?: string) => new MetricsController(service, { get: () => token } as never);

  beforeEach(() => jest.clearAllMocks());

  it('sin METRICS_TOKEN configurado el endpoint no existe: apagado por defecto', async () => {
    await expect(controller(undefined).scrape('lo-que-sea', res() as never))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('con token configurado, exige el token correcto', async () => {
    await expect(controller('el-bueno').scrape('Bearer el-malo', res() as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sin Authorization tampoco: las métricas cuentan cómo está armada la casa por dentro', async () => {
    await expect(controller('el-bueno').scrape(undefined, res() as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('con el token correcto devuelve las métricas en el formato que espera Prometheus', async () => {
    const respuesta = res();
    await controller('el-bueno').scrape('Bearer el-bueno', respuesta as never);
    expect(respuesta.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(respuesta.send).toHaveBeenCalledWith('# HELP algo\n');
  });
});
