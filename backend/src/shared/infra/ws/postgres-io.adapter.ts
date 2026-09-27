import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/postgres-adapter';
import type { Pool } from 'pg';
import type { ServerOptions } from 'socket.io';

/**
 * Reparte los eventos de socket.io entre instancias usando Postgres.
 *
 * Sin esto, `server.to('user:x').emit(...)` sólo llega a los sockets conectados
 * a ESTA instancia: con dos procesos, la mitad de la clínica no se entera de las
 * notificaciones ni de los mensajes. El adaptador usa `LISTEN`/`NOTIFY`, que
 * Postgres ya trae, así que no hace falta un Redis ni un proveedor más.
 *
 * Si no hay pool, o si el adaptador no se puede armar, la app arranca igual con
 * el comportamiento de siempre —una sola instancia— y lo deja escrito en el log.
 * Quedarse sin chat entre instancias es un problema; no arrancar es uno peor.
 */
export class PostgresIoAdapter extends IoAdapter {
  private readonly log = new Logger(PostgresIoAdapter.name);

  constructor(app: INestApplicationContext, private readonly pool: Pool | null) {
    super(app);
  }

  /** Aislado para poder probar el cableado sin levantar un servidor HTTP. */
  protected buildServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, options);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = this.buildServer(port, options);

    if (!this.pool) {
      this.log.warn('Sin pool de Postgres: los sockets quedan en memoria (una sola instancia).');
      return server;
    }

    try {
      server.adapter(createAdapter(this.pool));
      this.log.log('Sockets repartidos entre instancias vía Postgres (LISTEN/NOTIFY).');
    } catch (error) {
      this.log.warn(`No se pudo activar el reparto entre instancias: ${(error as Error).message}`);
    }

    return server;
  }
}
