import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrades1781740800000 implements MigrationInterface {
  name = 'CreateTrades1781740800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE trade_side_enum AS ENUM ('BUY', 'SELL')`,
    );
    await queryRunner.query(
      `CREATE TYPE trade_status_enum AS ENUM ('PENDING', 'FILLED', 'CANCELLED', 'FAILED')`,
    );
    await queryRunner.query(`
      CREATE TABLE trades (
        id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id      UUID,
        symbol           VARCHAR         NOT NULL,
        side             trade_side_enum NOT NULL,
        quantity         NUMERIC,
        price            NUMERIC,
        status           trade_status_enum NOT NULL,
        binance_order_id VARCHAR,
        filled_at        TIMESTAMPTZ,
        created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_trades_user_id ON trades(user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_trades_user_id`);
    await queryRunner.query(`DROP TABLE trades`);
    await queryRunner.query(`DROP TYPE trade_status_enum`);
    await queryRunner.query(`DROP TYPE trade_side_enum`);
  }
}
