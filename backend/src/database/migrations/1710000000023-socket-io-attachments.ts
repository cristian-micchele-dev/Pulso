import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabla de apoyo del adaptador de socket.io sobre Postgres.
 *
 * El adaptador reparte los mensajes entre instancias con `LISTEN`/`NOTIFY`, que
 * tiene un tope de 8000 bytes por aviso. Cuando un payload no entra, lo guarda
 * acá y por el canal viaja sólo el id. Hoy ningún evento se acerca a ese tamaño
 * —un mensaje del chat tiene tope de 1000 caracteres—, pero sin la tabla el
 * adaptador falla justo el día que alguien mande algo grande.
 *
 * El nombre y las columnas los fija la librería: no son una decisión nuestra.
 */
export class SocketIoAttachments1710000000023 implements MigrationInterface {
  name = 'SocketIoAttachments1710000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "socket_io_attachments" (
        id          bigserial UNIQUE,
        created_at  timestamptz DEFAULT NOW(),
        payload     bytea
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "socket_io_attachments"`);
  }
}
