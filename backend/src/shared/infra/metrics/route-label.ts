interface PedidoRuteado {
  route?: { path?: string };
  originalUrl?: string;
}

/**
 * La etiqueta de ruta de una métrica: el PATRÓN, nunca la URL concreta.
 *
 * Es la diferencia entre `/turnos/:id` y `/turnos/9f3c-abc`. Cada valor distinto
 * de una etiqueta crea una serie temporal propia, así que usar la URL cruda
 * significa una serie por turno: con el tiempo, el servidor de métricas se cae
 * solo. Si Express no resolvió un patrón, todo va a una sola etiqueta en vez de
 * inventar una por pedido.
 */
export function routeLabel(req: PedidoRuteado): string {
  return req.route?.path ?? 'desconocida';
}
