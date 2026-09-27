import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El código del turno pasa a salir de una secuencia de Postgres.
 *
 * Antes se calculaba leyendo el último código y sumándole uno. Eso funciona con
 * una persona a la vez y falla con dos: ambas leen `TM-00008`, ambas generan
 * `TM-00009`, y como el código es UNIQUE la segunda revienta. Medido: de doce
 * reservas simultáneas —en horarios DISTINTOS, sin pisarse entre sí— entraba una
 * sola y once devolvían 500.
 *
 * `nextval()` es atómico: cada quien se lleva un número propio sin importar
 * cuántos pidan a la vez. Arranca donde quedó la numeración para no repetir
 * ninguno de los que ya existen.
 */
export class AppointmentCodeSequence1710000000024 implements MigrationInterface {
  name = 'AppointmentCodeSequence1710000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ siguiente }] = await queryRunner.query(`
      SELECT coalesce(max(substring(code from 4)::int), 0) + 1 AS siguiente
      FROM appointments WHERE code ~ '^TM-[0-9]+$'`);

    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS appointment_code_seq START WITH ${Number(siguiente)}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE IF EXISTS appointment_code_seq`);
  }
}
