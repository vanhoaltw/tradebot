import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndKeys1781654400000 implements MigrationInterface {
  name = 'CreateUsersAndKeys1781654400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE user_role_enum AS ENUM ('admin', 'user')`,
    );
    await queryRunner.query(`
      CREATE TABLE users (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_chat_id BIGINT      NOT NULL UNIQUE,
        role             user_role_enum NOT NULL DEFAULT 'user',
        is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE binance_keys (
        id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        encrypted_api_key TEXT    NOT NULL,
        encrypted_secret  TEXT    NOT NULL,
        label             TEXT,
        is_active         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_binance_keys_user_id ON binance_keys(user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_binance_keys_user_id`);
    await queryRunner.query(`DROP TABLE binance_keys`);
    await queryRunner.query(`DROP TABLE users`);
    await queryRunner.query(`DROP TYPE user_role_enum`);
  }
}
