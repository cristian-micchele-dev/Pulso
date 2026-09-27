import { routeLabel } from './route-label';

describe('routeLabel — el error que hace explotar cualquier sistema de métricas', () => {
  it('usa el PATRÓN de la ruta, no la URL con el id adentro', () => {
    // Con la URL cruda, cada turno crearía su propia serie temporal: un millón de
    // turnos, un millón de series, y el servidor de métricas de rodillas.
    expect(routeLabel({ route: { path: '/turnos/:id' }, originalUrl: '/api/v1/turnos/9f3c-abc' }))
      .toBe('/turnos/:id');
  });

  it('sin patrón no inventa: agrupa todo en una sola etiqueta', () => {
    expect(routeLabel({ originalUrl: '/api/v1/lo-que-sea/123' })).toBe('desconocida');
  });

  it('descarta el query string: ?q=perez no es otra ruta', () => {
    expect(routeLabel({ route: { path: '/pacientes' }, originalUrl: '/api/v1/pacientes?q=perez' }))
      .toBe('/pacientes');
  });
});
