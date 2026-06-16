# Tradebot Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the bootable NestJS foundation — validated config, AES-256-GCM key encryption, Postgres/TypeORM migrations, Redis, BullMQ, and a health endpoint — that every later tradebot sub-plan builds on.

**Architecture:** Modular monolith on NestJS 11. This plan delivers only cross-cutting infrastructure (the `common/`, `database/`, `queue/`, and `health/` foundations), not any trading feature. Secrets are validated at boot and never default-injected; the encryption service is the security-critical core and is built test-first. Postgres uses explicit migrations (`synchronize: false`) so schema changes are auditable.

**Tech Stack:** NestJS 11 · TypeScript (nodenext/CommonJS) · TypeORM + `pg` · `ioredis` · `@nestjs/bullmq` (BullMQ) · `@nestjs/terminus` · `class-validator`/`class-transformer` · pnpm · Jest.

---

## Roadmap context (where this fits)

This is **sub-plan 1 of 9**. Decided constraints from spec review (2026-06-16):
- **Binance Testnet first** — mainnet gated behind an env flag (consumed in the trading-core plan).
- **Multi-user from day 1.**
- **Safety controls required for v1** — circuit breaker, global kill switch, system-level spend caps, AI-decision audit log, news injection sanitization. This plan reserves their config homes (env vars) but implements them in later plans.

Later sub-plans (not in scope here): 2) Users & key custody · 3) Trading core · 4) Non-AI strategies · 5) Market data · 6) AI layer · 7) News · 8) Notifications + P&L · 9) Cross-cutting safety.

## Prerequisites for running this plan

A local Postgres and Redis must be reachable for the migration and health steps. Task 5 creates a `docker-compose.yml` for this; start it with `docker compose up -d` before Task 5's verification steps. Alternatively point `DATABASE_URL`/`REDIS_URL` at Neon/Upstash.

## File Structure (created by this plan)

| File | Responsibility |
|---|---|
| `src/config/env.validation.ts` | `class-validator` schema + `validate()` for all env vars |
| `src/config/config.module.ts` | Global `@nestjs/config` module wired to `validate` |
| `src/common/encryption/encryption.service.ts` | AES-256-GCM encrypt/decrypt (iv+tag+ciphertext) |
| `src/common/encryption/encryption.module.ts` | DI module exporting `EncryptionService` |
| `src/common/redis/redis.constants.ts` | `REDIS_CLIENT` injection token |
| `src/common/redis/redis.module.ts` | Global `ioredis` client provider |
| `src/database/data-source.ts` | TypeORM `DataSource` for the migration CLI |
| `src/database/database.module.ts` | `TypeOrmModule.forRootAsync` using `ConfigService` |
| `src/queue/queue.module.ts` | `BullModule.forRootAsync` shared queue connection |
| `src/health/redis.health.ts` | Terminus custom indicator pinging Redis |
| `src/health/health.controller.ts` | `GET /health` (DB + Redis) |
| `src/health/health.module.ts` | Wires Terminus + indicators |
| `src/app.module.ts` | Assembles all foundation modules (modified) |
| `docker-compose.yml` | Local Postgres + Redis for dev/test |
| `.env.example` | Documented env template |

---

### Task 1: Remove the NestJS starter scaffolding

**Files:**
- Delete: `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `test/app.e2e-spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Delete the starter files**

Run:
```bash
git rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts test/app.e2e-spec.ts
```

- [ ] **Step 2: Reduce `app.module.ts` to an empty shell**

Replace the entire contents of `src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 3: Verify the project still builds**

Run: `pnpm run build`
Expected: exits 0, no references to the deleted `AppController`/`AppService`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove NestJS starter scaffolding"
```

---

### Task 2: Install foundation dependencies

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Add runtime dependencies**

Run:
```bash
pnpm add @nestjs/config @nestjs/typeorm typeorm pg @nestjs/bullmq bullmq ioredis @nestjs/terminus class-validator class-transformer
```

- [ ] **Step 2: Add dev dependencies**

Run:
```bash
pnpm add -D @types/pg
```

- [ ] **Step 3: Verify install resolves and types compile**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add foundation dependencies"
```

---

### Task 3: Typed, validated configuration module

Fails fast at boot if any required secret is missing or malformed (e.g. an `ENCRYPTION_KEY` that isn't 32 bytes). Foundation-required vars are mandatory; vars consumed by later sub-plans are optional now but already validated.

**Files:**
- Create: `src/config/env.validation.ts`
- Create: `src/config/env.validation.spec.ts`
- Create: `src/config/config.module.ts`
- Create: `.env.example`

- [ ] **Step 1: Write the failing test**

Create `src/config/env.validation.spec.ts`:

```ts
import { validate } from './env.validation';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/tradebot',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('validate (env)', () => {
  it('accepts a valid environment and coerces PORT to a number', () => {
    const result = validate(valid);
    expect(result.PORT).toBe(3000);
    expect(typeof result.PORT).toBe('number');
  });

  it('rejects an ENCRYPTION_KEY that is not 64 hex chars', () => {
    expect(() => validate({ ...valid, ENCRYPTION_KEY: 'tooshort' })).toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => validate(rest)).toThrow();
  });

  it('rejects a non-hex ENCRYPTION_KEY of correct length', () => {
    expect(() => validate({ ...valid, ENCRYPTION_KEY: 'z'.repeat(64) })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- env.validation`
Expected: FAIL — cannot find module `./env.validation`.

- [ ] **Step 3: Implement the validation schema**

Create `src/config/env.validation.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number;

  // --- Foundation-required ---
  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  /** 32 bytes encoded as 64 hex chars, for AES-256-GCM. */
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
  })
  ENCRYPTION_KEY: string;

  // --- Consumed by later sub-plans (optional now, still validated) ---
  @IsString()
  @IsOptional()
  TELEGRAM_BOT_TOKEN?: string;

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  @IsEnum(['true', 'false'])
  @IsOptional()
  BINANCE_USE_TESTNET?: 'true' | 'false';

  @IsNumber()
  @Min(0)
  @IsOptional()
  MAX_SINGLE_ORDER_USDT?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  MAX_DAILY_SPEND_USDT?: number;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }
  return validated;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- env.validation`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the config module**

Create `src/config/config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validate } from './env.validation';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate,
    }),
  ],
})
export class ConfigModule {}
```

- [ ] **Step 6: Create `.env.example`**

Create `.env.example`:

```bash
NODE_ENV=development
PORT=3000

# Foundation-required
DATABASE_URL=postgres://tradebot:tradebot@localhost:5432/tradebot
REDIS_URL=redis://localhost:6379
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=

# Used by later sub-plans (optional for foundation)
TELEGRAM_BOT_TOKEN=
ANTHROPIC_API_KEY=
BINANCE_USE_TESTNET=true
MAX_SINGLE_ORDER_USDT=500
MAX_DAILY_SPEND_USDT=2000
```

- [ ] **Step 7: Commit**

```bash
git add src/config .env.example
git commit -m "feat: add validated configuration module"
```

---

### Task 4: EncryptionService (AES-256-GCM) — security core

Built test-first. Encrypts to `base64(iv ‖ authTag ‖ ciphertext)`; decryption fails loudly on tampering or wrong key (GCM auth tag). The key is read once from validated config and asserted to be 32 bytes. Closes spec review gap #5 (GCM nonce/tag storage).

**Files:**
- Create: `src/common/encryption/encryption.service.ts`
- Create: `src/common/encryption/encryption.service.spec.ts`
- Create: `src/common/encryption/encryption.module.ts`

- [ ] **Step 1: Write the failing test**

Create `src/common/encryption/encryption.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function serviceWithKey(hexKey: string): EncryptionService {
  const config = { get: () => hexKey } as unknown as ConfigService;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext value', () => {
    const svc = serviceWithKey(KEY_A);
    const secret = 'binance-secret-key-123';
    const ciphertext = svc.encrypt(secret);
    expect(ciphertext).not.toContain(secret);
    expect(svc.decrypt(ciphertext)).toBe(secret);
  });

  it('produces a different ciphertext each time (unique IV)', () => {
    const svc = serviceWithKey(KEY_A);
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('fails to decrypt when the auth tag/ciphertext is tampered', () => {
    const svc = serviceWithKey(KEY_A);
    const ct = svc.encrypt('tamper-me');
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const enc = serviceWithKey(KEY_A);
    const dec = serviceWithKey(KEY_B);
    expect(() => dec.decrypt(enc.encrypt('x'))).toThrow();
  });

  it('throws at construction if the key is not 32 bytes', () => {
    expect(() => serviceWithKey('a'.repeat(10))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- encryption.service`
Expected: FAIL — cannot find module `./encryption.service`.

- [ ] **Step 3: Implement the service**

Create `src/common/encryption/encryption.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const TAG_LENGTH = 16;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.get<string>('ENCRYPTION_KEY', { infer: true }) ?? '';
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const data = Buffer.from(payload, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- encryption.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the encryption module**

Create `src/common/encryption/encryption.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/common/encryption
git commit -m "feat: add AES-256-GCM encryption service"
```

---

### Task 5: Database module — TypeORM DataSource + migrations

Provides a CLI `DataSource` (for generating/running migrations) and a Nest async module sharing the same options. `synchronize` is always `false`. Also creates `docker-compose.yml` for local Postgres + Redis.

**Files:**
- Create: `src/database/data-source.ts`
- Create: `src/database/database.module.ts`
- Create: `docker-compose.yml`
- Modify: `package.json` (migration scripts)

- [ ] **Step 1: Create local dev services**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: tradebot
      POSTGRES_PASSWORD: tradebot
      POSTGRES_DB: tradebot
    ports:
      - '5432:5432'
    volumes:
      - tradebot_pg:/var/lib/postgresql/data
  redis:
    image: redis:7
    ports:
      - '6379:6379'

volumes:
  tradebot_pg:
```

- [ ] **Step 2: Create the CLI DataSource**

Create `src/database/data-source.ts`:

```ts
import 'dotenv/config';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: false,
});

export default AppDataSource;
```

> Note: `dotenv` ships transitively with `@nestjs/config`. If `import 'dotenv/config'` fails to resolve, run `pnpm add -D dotenv` and commit the lockfile change.

- [ ] **Step 3: Create the Nest database module**

Create `src/database/database.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL', { infer: true }),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

- [ ] **Step 4: Add migration scripts to `package.json`**

In `package.json`, add these entries to the `"scripts"` object:

```json
    "typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts",
    "migration:generate": "pnpm run typeorm migration:generate",
    "migration:run": "pnpm run typeorm migration:run",
    "migration:revert": "pnpm run typeorm migration:revert"
```

- [ ] **Step 5: Verify the DataSource connects**

Start services and confirm the CLI can reach Postgres (no migrations exist yet, so `migration:run` is a no-op success):

Run:
```bash
docker compose up -d
DATABASE_URL=postgres://tradebot:tradebot@localhost:5432/tradebot pnpm run migration:run
```
Expected: connects and prints "No migrations are pending" (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/database docker-compose.yml package.json pnpm-lock.yaml
git commit -m "feat: add TypeORM database module and migration tooling"
```

---

### Task 6: Redis client module

A single shared `ioredis` client provided under the `REDIS_CLIENT` token, used by BullMQ, the health check, and later caches. `maxRetriesPerRequest: null` is required for BullMQ compatibility.

**Files:**
- Create: `src/common/redis/redis.constants.ts`
- Create: `src/common/redis/redis.module.ts`

- [ ] **Step 1: Create the injection token**

Create `src/common/redis/redis.constants.ts`:

```ts
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
```

- [ ] **Step 2: Create the Redis module**

Create `src/common/redis/redis.module.ts`:

```ts
import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL', { infer: true }) as string, {
          maxRetriesPerRequest: null,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT);
    await client.quit();
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/common/redis
git commit -m "feat: add shared ioredis client module"
```

---

### Task 7: BullMQ root module

Configures the shared BullMQ connection so later sub-plans can register queues with `BullModule.registerQueue(...)`. No queues are registered here.

**Files:**
- Create: `src/queue/queue.module.ts`

- [ ] **Step 1: Create the queue module**

Create `src/queue/queue.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL', { infer: true }),
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/queue
git commit -m "feat: add shared BullMQ root module"
```

---

### Task 8: Health module (Terminus)

`GET /health` reports DB and Redis liveness — the smoke signal CI/uptime checks hit. Uses Terminus' built-in `TypeOrmHealthIndicator` plus a custom Redis indicator.

**Files:**
- Create: `src/health/redis.health.ts`
- Create: `src/health/health.controller.ts`
- Create: `src/health/health.module.ts`

- [ ] **Step 1: Create the Redis health indicator**

Create `src/health/redis.health.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.constants';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`unexpected ping reply: ${pong}`);
      }
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
```

- [ ] **Step 2: Create the health controller**

Create `src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.pingCheck('redis'),
    ]);
  }
}
```

- [ ] **Step 3: Create the health module**

Create `src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/health
git commit -m "feat: add health check endpoint"
```

---

### Task 9: Assemble AppModule and prove the app boots

Wire everything together and add an e2e test that boots the full module graph and gets `200` from `/health`. This is the integration proof that config, DB, Redis, BullMQ, and Terminus all initialize together.

**Files:**
- Modify: `src/app.module.ts`
- Create: `test/health.e2e-spec.ts`

- [ ] **Step 1: Assemble the AppModule**

Replace the contents of `src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { RedisModule } from './common/redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    EncryptionModule,
    RedisModule,
    DatabaseModule,
    QueueModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Write the e2e health test**

Create `test/health.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health returns 200 and ok status', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info).toHaveProperty('database');
    expect(res.body.info).toHaveProperty('redis');
  });
});
```

- [ ] **Step 3: Ensure env + services are available for the e2e run**

The e2e test boots the real graph, so Postgres and Redis must be up and env vars set. Create a local `.env` from `.env.example` with a generated key first:

Run:
```bash
docker compose up -d
cp .env.example .env
node -e "const fs=require('fs');const k=require('crypto').randomBytes(32).toString('hex');fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(/^ENCRYPTION_KEY=.*$/m,'ENCRYPTION_KEY='+k))"
```
Expected: `.env` now has a 64-hex `ENCRYPTION_KEY`. Confirm `.env` is ignored with `git check-ignore .env` (the starter `.gitignore` already ignores `.env`).

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm run test:e2e -- health`
Expected: PASS — `GET /health returns 200 and ok status`.

- [ ] **Step 5: Run the full unit suite and lint**

Run: `pnpm test && pnpm run lint`
Expected: all unit tests pass (env.validation + encryption), lint exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts test/health.e2e-spec.ts
git commit -m "feat: assemble foundation app module with health e2e"
```

---

## Self-Review

**Spec coverage (foundation slice):** `common/` encryption + redis ✓ (Tasks 4, 6) · `database` TypeORM config ✓ (Task 5) · Redis client to host the spec's key schema ✓ (Task 6) · BullMQ host for strategy/AI/notification queues ✓ (Task 7) · `@nestjs/config` ✓ (Task 3) · AES-256-GCM with IV+tag, closing spec gap #5 ✓ (Task 4). Telegram/trading/AI/strategy/news/pnl modules are intentionally out of scope — sub-plans 2–9. Safety-control env homes (`MAX_SINGLE_ORDER_USDT`, `MAX_DAILY_SPEND_USDT`, `BINANCE_USE_TESTNET`) are reserved in Task 3 for later wiring.

**Placeholder scan:** No `TBD`/`add validation`/`handle edge cases` steps; every code step shows full code; every run step states an expected result.

**Type/name consistency:** `validate` exported by `env.validation.ts`, consumed in `config.module.ts` + its spec ✓ · `EncryptionService(ConfigService)` constructor matches the spec's `serviceWithKey` helper ✓ · `REDIS_CLIENT` token defined once in `redis.constants.ts`, imported by `redis.module.ts` + `redis.health.ts` ✓ · `pingCheck` matches between `RedisHealthIndicator` and `health.controller.ts` ✓ · `AppDataSource` options mirror `database.module.ts` (`synchronize: false`, same `DATABASE_URL`) ✓.

**Known follow-ups deferred by design:** ENCRYPTION_KEY rotation (sub-plan 2, when keys are first stored); no entities/migrations yet (first real entity arrives in sub-plan 2 "Users").
