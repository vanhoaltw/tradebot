# Tradebot Users & Key Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users register over Telegram and store their Binance API keys encrypted at rest, with a guided `/setkeys` flow that validates the keys against Binance (testnet by default) before saving.

**Architecture:** Builds on the merged Foundation. A `users` module owns the `User` entity and all key custody logic, reusing the existing `EncryptionService` so plaintext keys never hit the database. A `telegram` module (nestjs-telegraf, long polling) is the user interface; multi-step flows (`/setkeys`) keep conversation state in Redis under the spec's `user:{telegramId}:state` key rather than in-memory, so the bot is restart-safe and horizontally scalable. Binance key validation lives in a small, isolated `BinanceKeyValidator` (full trading client is sub-plan 3).

**Tech Stack:** NestJS 11 · TypeORM (Postgres) · nestjs-telegraf + telegraf 4 · ioredis (existing `REDIS_CLIENT`) · Node `crypto` HMAC · Jest.

---

## Roadmap context

This is **sub-plan 2 of 9**. Depends on sub-plan 1 (Foundation), already merged to `main`: `EncryptionService`, `ConfigModule`, `DatabaseModule` (TypeORM + migrations), `REDIS_CLIENT`, BullMQ, health.

Decided constraints (see project memory `tradebot-v1-constraints`): **multi-user from day 1**, **Binance Testnet first** (`BINANCE_USE_TESTNET=true` gates the base URL), **safety controls required for v1**. This sub-plan implements the identity + custody layer; trading execution and the safety controls are later sub-plans.

**Security stance for this sub-plan:**
- `telegramId` comes from `ctx.from.id`, which the Telegram Bot API authenticates — it is the trusted user identifier. Every DB lookup is scoped by it.
- API secret is entered in chat during `/setkeys`; the bot **deletes the user's secret message immediately** after reading it and never echoes keys back.
- Keys are validated against Binance before storage so a typo can't be silently saved.
- Keys are encrypted with `EncryptionService` (AES-256-GCM) before they touch Postgres.

## Prerequisites

- Foundation merged; `docker compose up -d` running Postgres (5432) + Redis (host 6380).
- A **Telegram bot token** from @BotFather in `.env` as `TELEGRAM_BOT_TOKEN` (required for the Telegram tasks' manual verification; service/validator unit tests do not need it).
- A **Binance Testnet** API key/secret from https://testnet.binance.vision for end-to-end manual verification of `/setkeys`.

## File Structure (created by this plan)

| File | Responsibility |
|---|---|
| `src/users/user.entity.ts` | `User` TypeORM entity |
| `src/database/migrations/<ts>-CreateUsers.ts` | `users` table migration |
| `src/users/users.service.ts` | Register, find, encrypted key set/get/clear |
| `src/users/users.service.spec.ts` | Unit tests (fake repo + real EncryptionService) |
| `src/users/users.module.ts` | DI wiring for the users feature |
| `src/binance/binance-key-validator.service.ts` | Testnet-aware signed `/account` key check |
| `src/binance/binance-key-validator.service.spec.ts` | Unit tests (mocked `fetch`) |
| `src/binance/binance.module.ts` | DI wiring for the binance helper |
| `src/telegram/telegram.constants.ts` | Redis state key + flow enums |
| `src/telegram/setkeys.state.ts` | Redis-backed `/setkeys` conversation state store |
| `src/telegram/setkeys.state.spec.ts` | Unit tests (mocked `REDIS_CLIENT`) |
| `src/telegram/telegram.update.ts` | Telegraf `@Update` handlers (`/start`, `/setkeys`, `/deletekeys`, `/status`, text) |
| `src/telegram/telegram.update.spec.ts` | Handler unit tests (mock `Ctx`) |
| `src/telegram/telegram.module.ts` | `TelegrafModule.forRootAsync` + handlers |
| `src/app.module.ts` | Register the three new modules (modified) |

---

### Task 1: User entity + migration

**Files:**
- Create: `src/users/user.entity.ts`
- Create: `src/database/migrations/1718500000000-CreateUsers.ts`

- [ ] **Step 1: Create the entity**

`telegramId` is stored as `bigint`. Postgres `bigint` exceeds JS safe-integer range, and TypeORM returns it as a **string** — so the entity types it as `string` and handlers convert `ctx.from.id` with `String(...)`. Encrypted columns are `text` (GCM output is variable-length base64).

Create `src/users/user.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'bigint', unique: true })
  telegramId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username!: string | null;

  /** AES-256-GCM ciphertext (iv|tag|ciphertext, base64). Null until /setkeys. */
  @Column({ type: 'text', nullable: true })
  binanceApiKey!: string | null;

  /** AES-256-GCM ciphertext. Null until /setkeys. */
  @Column({ type: 'text', nullable: true })
  binanceSecretKey!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 2: Write the migration**

Hand-written (deterministic) rather than generated. Create `src/database/migrations/1718500000000-CreateUsers.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1718500000000 implements MigrationInterface {
  name = 'CreateUsers1718500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "telegramId" bigint NOT NULL,
        "username" character varying(255),
        "binanceApiKey" text,
        "binanceSecretKey" text,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_telegramId" UNIQUE ("telegramId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
```

> `gen_random_uuid()` is built into Postgres 13+ (our image is 16), so no `pgcrypto` extension is needed.

- [ ] **Step 3: Run the migration**

Run:
```bash
DATABASE_URL=postgres://tradebot:tradebot@localhost:5432/tradebot pnpm run migration:run
```
Expected: `CreateUsers1718500000000` runs; ends without error.

- [ ] **Step 4: Verify the table exists**

Run:
```bash
docker compose exec -T postgres psql -U tradebot -d tradebot -c "\d users"
```
Expected: shows `users` with columns `id, telegramId, username, binanceApiKey, binanceSecretKey, isActive, createdAt` and a unique constraint on `telegramId`.

- [ ] **Step 5: Commit**

```bash
git add src/users/user.entity.ts src/database/migrations
git commit -m "feat(users): add User entity and users table migration"
```

---

### Task 2: UsersService (registration + encrypted key custody)

TDD. Unit-tested with a fake repository and the **real** `EncryptionService`, so the tests prove plaintext keys are never stored and round-trip correctly.

**Files:**
- Create: `src/users/users.service.ts`
- Create: `src/users/users.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/users/users.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { EncryptionService } from '../common/encryption/encryption.service';
import { User } from './user.entity';
import { UsersService } from './users.service';

function fakeRepo(): Repository<User> {
  const rows: User[] = [];
  return {
    create: (data: Partial<User>) => ({ ...data }) as User,
    save: async (u: User) => {
      const existing = rows.find((r) => r.telegramId === u.telegramId);
      if (existing) Object.assign(existing, u);
      else rows.push(u);
      return u;
    },
    findOne: async ({ where }: { where: { telegramId: string } }) =>
      rows.find((r) => r.telegramId === where.telegramId) ?? null,
  } as unknown as Repository<User>;
}

function makeService(): { svc: UsersService; enc: EncryptionService } {
  const config = { get: () => 'a'.repeat(64) } as unknown as ConfigService;
  const enc = new EncryptionService(config);
  const svc = new UsersService(fakeRepo(), enc);
  return { svc, enc };
}

describe('UsersService', () => {
  it('registers a new user from telegram identity', async () => {
    const { svc } = makeService();
    const user = await svc.registerFromTelegram('12345', 'alice');
    expect(user.telegramId).toBe('12345');
    expect(user.username).toBe('alice');
    expect(user.isActive).toBe(true);
  });

  it('is idempotent on repeated registration', async () => {
    const { svc } = makeService();
    await svc.registerFromTelegram('12345', 'alice');
    const again = await svc.registerFromTelegram('12345', 'alice2');
    expect(again.telegramId).toBe('12345');
    expect(again.username).toBe('alice2');
  });

  it('stores keys encrypted and retrieves them decrypted', async () => {
    const { svc, enc } = makeService();
    await svc.registerFromTelegram('12345', 'alice');
    await svc.setBinanceKeys('12345', 'API_PLAINTEXT', 'SECRET_PLAINTEXT');

    const stored = await svc.findByTelegramId('12345');
    expect(stored?.binanceApiKey).not.toBe('API_PLAINTEXT');
    expect(stored?.binanceSecretKey).not.toBe('SECRET_PLAINTEXT');
    expect(enc.decrypt(stored!.binanceApiKey!)).toBe('API_PLAINTEXT');

    const creds = await svc.getBinanceCredentials('12345');
    expect(creds).toEqual({ apiKey: 'API_PLAINTEXT', secret: 'SECRET_PLAINTEXT' });
  });

  it('returns null credentials when keys are not set', async () => {
    const { svc } = makeService();
    await svc.registerFromTelegram('12345', 'alice');
    expect(await svc.getBinanceCredentials('12345')).toBeNull();
  });

  it('clears stored keys', async () => {
    const { svc } = makeService();
    await svc.registerFromTelegram('12345', 'alice');
    await svc.setBinanceKeys('12345', 'API', 'SECRET');
    await svc.clearBinanceKeys('12345');
    expect(await svc.getBinanceCredentials('12345')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- users.service`
Expected: FAIL — cannot find module `./users.service`.

- [ ] **Step 3: Implement the service**

Create `src/users/users.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../common/encryption/encryption.service';
import { User } from './user.entity';

export interface BinanceCredentials {
  apiKey: string;
  secret: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly encryption: EncryptionService,
  ) {}

  async registerFromTelegram(
    telegramId: string,
    username: string | null,
  ): Promise<User> {
    const existing = await this.findByTelegramId(telegramId);
    if (existing) {
      existing.username = username;
      return this.users.save(existing);
    }
    const user = this.users.create({
      telegramId,
      username,
      isActive: true,
    });
    return this.users.save(user);
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.users.findOne({ where: { telegramId } });
  }

  private async require(telegramId: string): Promise<User> {
    const user = await this.findByTelegramId(telegramId);
    if (!user) throw new NotFoundException(`Unknown user ${telegramId}`);
    return user;
  }

  async setBinanceKeys(
    telegramId: string,
    apiKey: string,
    secret: string,
  ): Promise<void> {
    const user = await this.require(telegramId);
    user.binanceApiKey = this.encryption.encrypt(apiKey);
    user.binanceSecretKey = this.encryption.encrypt(secret);
    await this.users.save(user);
  }

  async getBinanceCredentials(
    telegramId: string,
  ): Promise<BinanceCredentials | null> {
    const user = await this.findByTelegramId(telegramId);
    if (!user?.binanceApiKey || !user.binanceSecretKey) return null;
    return {
      apiKey: this.encryption.decrypt(user.binanceApiKey),
      secret: this.encryption.decrypt(user.binanceSecretKey),
    };
  }

  async clearBinanceKeys(telegramId: string): Promise<void> {
    const user = await this.require(telegramId);
    user.binanceApiKey = null;
    user.binanceSecretKey = null;
    await this.users.save(user);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- users.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat(users): add UsersService with encrypted key custody"
```

---

### Task 3: UsersModule

**Files:**
- Create: `src/users/users.module.ts`

- [ ] **Step 1: Create the module**

Create `src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/users/users.module.ts
git commit -m "feat(users): add UsersModule"
```

---

### Task 4: BinanceKeyValidator (testnet-aware signed check)

TDD with a mocked global `fetch`. Performs a signed `GET /api/v3/account` — the lightest authenticated call that proves the key/secret pair is valid and has account access. Base URL is chosen from `BINANCE_USE_TESTNET`.

**Files:**
- Create: `src/binance/binance-key-validator.service.ts`
- Create: `src/binance/binance-key-validator.service.spec.ts`
- Create: `src/binance/binance.module.ts`

- [ ] **Step 1: Write the failing test**

Create `src/binance/binance-key-validator.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { BinanceKeyValidator } from './binance-key-validator.service';

function validator(useTestnet: string): BinanceKeyValidator {
  const config = {
    get: (key: string) =>
      key === 'BINANCE_USE_TESTNET' ? useTestnet : undefined,
  } as unknown as ConfigService;
  return new BinanceKeyValidator(config);
}

describe('BinanceKeyValidator', () => {
  afterEach(() => jest.restoreAllMocks());

  it('hits the testnet host and signs the request when valid', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const ok = await validator('true').validate('API', 'SECRET');

    expect(ok).toBe(true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('testnet.binance.vision');
    expect(url).toContain('signature=');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-MBX-APIKEY']).toBe('API');
  });

  it('uses the mainnet host when testnet is disabled', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await validator('false').validate('API', 'SECRET');
    expect(fetchMock.mock.calls[0][0] as string).toContain('api.binance.com');
  });

  it('returns false on a rejected key (401)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{"code":-2015}', { status: 401 }));
    expect(await validator('true').validate('BAD', 'BAD')).toBe(false);
  });

  it('returns false when the request throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    expect(await validator('true').validate('API', 'SECRET')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- binance-key-validator`
Expected: FAIL — cannot find module `./binance-key-validator.service`.

- [ ] **Step 3: Implement the validator**

Create `src/binance/binance-key-validator.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

const MAINNET = 'https://api.binance.com';
const TESTNET = 'https://testnet.binance.vision';

@Injectable()
export class BinanceKeyValidator {
  private readonly logger = new Logger(BinanceKeyValidator.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return this.config.get<string>('BINANCE_USE_TESTNET', { infer: true }) ===
      'true'
      ? TESTNET
      : MAINNET;
  }

  /** Returns true if the key/secret pair authenticates against Binance. */
  async validate(apiKey: string, secret: string): Promise<boolean> {
    const query = `timestamp=${Date.now()}&recvWindow=5000`;
    const signature = createHmac('sha256', secret).update(query).digest('hex');
    const url = `${this.baseUrl()}/api/v3/account?${query}&signature=${signature}`;
    try {
      const res = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
      return res.ok;
    } catch (err) {
      this.logger.warn(
        `Key validation request failed: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- binance-key-validator`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the module**

Create `src/binance/binance.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BinanceKeyValidator } from './binance-key-validator.service';

@Module({
  providers: [BinanceKeyValidator],
  exports: [BinanceKeyValidator],
})
export class BinanceModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/binance
git commit -m "feat(binance): add testnet-aware Binance key validator"
```

---

### Task 5: `/setkeys` conversation state (Redis-backed)

TDD. A tiny store over the existing `REDIS_CLIENT` that tracks where a user is in the `/setkeys` flow, matching the spec's `user:{telegramId}:state` key with a TTL so abandoned flows expire.

**Files:**
- Create: `src/telegram/telegram.constants.ts`
- Create: `src/telegram/setkeys.state.ts`
- Create: `src/telegram/setkeys.state.spec.ts`

- [ ] **Step 1: Create the constants**

Create `src/telegram/telegram.constants.ts`:

```ts
export const SETKEYS_STATE_TTL_SECONDS = 300;

export enum SetKeysStep {
  AwaitingApiKey = 'AWAITING_API_KEY',
  AwaitingSecret = 'AWAITING_SECRET',
}

export interface SetKeysState {
  step: SetKeysStep;
  apiKey?: string;
}

export const setKeysStateKey = (telegramId: string): string =>
  `user:${telegramId}:state`;
```

- [ ] **Step 2: Write the failing test**

Create `src/telegram/setkeys.state.spec.ts`:

```ts
import Redis from 'ioredis';
import { SetKeysStateStore } from './setkeys.state';
import { SetKeysStep } from './telegram.constants';

function fakeRedis(): Redis {
  const map = new Map<string, string>();
  return {
    set: async (k: string, v: string) => {
      map.set(k, v);
      return 'OK';
    },
    get: async (k: string) => map.get(k) ?? null,
    del: async (k: string) => (map.delete(k) ? 1 : 0),
  } as unknown as Redis;
}

describe('SetKeysStateStore', () => {
  it('starts a flow at AWAITING_API_KEY', async () => {
    const store = new SetKeysStateStore(fakeRedis());
    await store.start('12345');
    expect(await store.get('12345')).toEqual({
      step: SetKeysStep.AwaitingApiKey,
    });
  });

  it('advances to AWAITING_SECRET carrying the api key', async () => {
    const store = new SetKeysStateStore(fakeRedis());
    await store.start('12345');
    await store.setApiKey('12345', 'API');
    expect(await store.get('12345')).toEqual({
      step: SetKeysStep.AwaitingSecret,
      apiKey: 'API',
    });
  });

  it('clears the flow', async () => {
    const store = new SetKeysStateStore(fakeRedis());
    await store.start('12345');
    await store.clear('12345');
    expect(await store.get('12345')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- setkeys.state`
Expected: FAIL — cannot find module `./setkeys.state`.

- [ ] **Step 4: Implement the store**

Create `src/telegram/setkeys.state.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.constants';
import {
  SetKeysState,
  SetKeysStep,
  SETKEYS_STATE_TTL_SECONDS,
  setKeysStateKey,
} from './telegram.constants';

@Injectable()
export class SetKeysStateStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private async write(telegramId: string, state: SetKeysState): Promise<void> {
    await this.redis.set(
      setKeysStateKey(telegramId),
      JSON.stringify(state),
      'EX',
      SETKEYS_STATE_TTL_SECONDS,
    );
  }

  async start(telegramId: string): Promise<void> {
    await this.write(telegramId, { step: SetKeysStep.AwaitingApiKey });
  }

  async setApiKey(telegramId: string, apiKey: string): Promise<void> {
    await this.write(telegramId, { step: SetKeysStep.AwaitingSecret, apiKey });
  }

  async get(telegramId: string): Promise<SetKeysState | null> {
    const raw = await this.redis.get(setKeysStateKey(telegramId));
    return raw ? (JSON.parse(raw) as SetKeysState) : null;
  }

  async clear(telegramId: string): Promise<void> {
    await this.redis.del(setKeysStateKey(telegramId));
  }
}
```

> The fake redis in the test ignores the `'EX'`/TTL args, which is fine — it only asserts the stored value. Real ioredis applies the TTL.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- setkeys.state`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/telegram/telegram.constants.ts src/telegram/setkeys.state.ts src/telegram/setkeys.state.spec.ts
git commit -m "feat(telegram): add Redis-backed /setkeys conversation state"
```

---

### Task 6: Install nestjs-telegraf + Telegram handlers

TDD for the handler logic (mocked Telegraf context); the live bot is verified manually in Task 7.

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/telegram/telegram.update.ts`
- Create: `src/telegram/telegram.update.spec.ts`

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add nestjs-telegraf telegraf
```
Expected: both resolve; `pnpm run build` still exits 0.

> If pnpm reports a new ignored build script, add it as `false` under `allowBuilds:` in `pnpm-workspace.yaml` (same fix pattern as Foundation) and re-run `pnpm install`.

- [ ] **Step 2: Write the failing handler test**

Create `src/telegram/telegram.update.spec.ts`:

```ts
import { UsersService } from '../users/users.service';
import { BinanceKeyValidator } from '../binance/binance-key-validator.service';
import { SetKeysStateStore } from './setkeys.state';
import { SetKeysStep } from './telegram.constants';
import { TelegramUpdate } from './telegram.update';

type Ctx = {
  from?: { id: number; username?: string };
  message?: { text?: string };
  reply: jest.Mock;
  deleteMessage: jest.Mock;
};

function ctx(text?: string, id = 12345, username = 'alice'): Ctx {
  return {
    from: { id, username },
    message: text === undefined ? undefined : { text },
    reply: jest.fn().mockResolvedValue(undefined),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
  };
}

function setup() {
  const users = {
    registerFromTelegram: jest.fn().mockResolvedValue(undefined),
    setBinanceKeys: jest.fn().mockResolvedValue(undefined),
    clearBinanceKeys: jest.fn().mockResolvedValue(undefined),
    findByTelegramId: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<UsersService>;
  const validator = {
    validate: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<BinanceKeyValidator>;
  const state = {
    start: jest.fn().mockResolvedValue(undefined),
    setApiKey: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    clear: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SetKeysStateStore>;
  return {
    update: new TelegramUpdate(users, validator, state),
    users,
    validator,
    state,
  };
}

describe('TelegramUpdate', () => {
  it('/start registers the user and welcomes them', async () => {
    const { update, users } = setup();
    const c = ctx();
    await update.onStart(c as never);
    expect(users.registerFromTelegram).toHaveBeenCalledWith('12345', 'alice');
    expect(c.reply).toHaveBeenCalled();
  });

  it('/setkeys begins the flow and prompts for the API key', async () => {
    const { update, state } = setup();
    const c = ctx();
    await update.onSetKeys(c as never);
    expect(state.start).toHaveBeenCalledWith('12345');
    expect(c.reply).toHaveBeenCalled();
  });

  it('text in AWAITING_API_KEY stores the key, deletes the message, asks for secret', async () => {
    const { update, state } = setup();
    state.get.mockResolvedValue({ step: SetKeysStep.AwaitingApiKey });
    const c = ctx('MY_API_KEY');
    await update.onText(c as never);
    expect(state.setApiKey).toHaveBeenCalledWith('12345', 'MY_API_KEY');
    expect(c.deleteMessage).toHaveBeenCalled();
  });

  it('text in AWAITING_SECRET validates, saves, deletes the secret, clears state', async () => {
    const { update, users, validator, state } = setup();
    state.get.mockResolvedValue({
      step: SetKeysStep.AwaitingSecret,
      apiKey: 'MY_API_KEY',
    });
    const c = ctx('MY_SECRET');
    await update.onText(c as never);
    expect(validator.validate).toHaveBeenCalledWith('MY_API_KEY', 'MY_SECRET');
    expect(users.setBinanceKeys).toHaveBeenCalledWith(
      '12345',
      'MY_API_KEY',
      'MY_SECRET',
    );
    expect(c.deleteMessage).toHaveBeenCalled();
    expect(state.clear).toHaveBeenCalledWith('12345');
  });

  it('rejected keys are not saved and the flow is cleared', async () => {
    const { update, users, validator, state } = setup();
    validator.validate.mockResolvedValue(false);
    state.get.mockResolvedValue({
      step: SetKeysStep.AwaitingSecret,
      apiKey: 'BAD',
    });
    await update.onText(ctx('BAD') as never);
    expect(users.setBinanceKeys).not.toHaveBeenCalled();
    expect(state.clear).toHaveBeenCalledWith('12345');
  });

  it('ignores plain text when no flow is active', async () => {
    const { update, state } = setup();
    state.get.mockResolvedValue(null);
    const c = ctx('just chatting');
    await update.onText(c as never);
    expect(state.setApiKey).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- telegram.update`
Expected: FAIL — cannot find module `./telegram.update`.

- [ ] **Step 4: Implement the handlers**

Create `src/telegram/telegram.update.ts`:

```ts
import { Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import { BinanceKeyValidator } from '../binance/binance-key-validator.service';
import { UsersService } from '../users/users.service';
import { SetKeysStateStore } from './setkeys.state';
import { SetKeysStep } from './telegram.constants';

@Update()
export class TelegramUpdate {
  constructor(
    private readonly users: UsersService,
    private readonly validator: BinanceKeyValidator,
    private readonly state: SetKeysStateStore,
  ) {}

  private telegramId(ctx: Context): string {
    return String(ctx.from?.id);
  }

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await this.users.registerFromTelegram(
      this.telegramId(ctx),
      ctx.from?.username ?? null,
    );
    await ctx.reply(
      'Welcome to Tradebot. Use /setkeys to connect your Binance account, then /status to check it.',
    );
  }

  @Command('setkeys')
  async onSetKeys(@Ctx() ctx: Context): Promise<void> {
    await this.state.start(this.telegramId(ctx));
    await ctx.reply(
      'Send your Binance API key. (Create a key with Spot trading only — no withdrawals.) Your messages will be deleted after I read them.',
    );
  }

  @Command('deletekeys')
  async onDeleteKeys(@Ctx() ctx: Context): Promise<void> {
    await this.users.clearBinanceKeys(this.telegramId(ctx));
    await ctx.reply('Your Binance API keys have been removed.');
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context): Promise<void> {
    const user = await this.users.findByTelegramId(this.telegramId(ctx));
    const connected = !!user?.binanceApiKey;
    await ctx.reply(
      connected
        ? 'Binance keys: connected ✅'
        : 'Binance keys: not set. Use /setkeys to connect.',
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    const telegramId = this.telegramId(ctx);
    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (!text || text.startsWith('/')) return;

    const flow = await this.state.get(telegramId);
    if (!flow) return;

    if (flow.step === SetKeysStep.AwaitingApiKey) {
      await this.state.setApiKey(telegramId, text.trim());
      await this.safeDelete(ctx);
      await ctx.reply('Got it. Now send your Binance API secret.');
      return;
    }

    if (flow.step === SetKeysStep.AwaitingSecret && flow.apiKey) {
      await this.safeDelete(ctx);
      const secret = text.trim();
      const valid = await this.validator.validate(flow.apiKey, secret);
      if (!valid) {
        await this.state.clear(telegramId);
        await ctx.reply(
          'Those keys were rejected by Binance. Nothing was saved. Run /setkeys to try again.',
        );
        return;
      }
      await this.users.setBinanceKeys(telegramId, flow.apiKey, secret);
      await this.state.clear(telegramId);
      await ctx.reply('Binance account connected ✅. Use /status to confirm.');
    }
  }

  private async safeDelete(ctx: Context): Promise<void> {
    try {
      await ctx.deleteMessage();
    } catch {
      // Bot may lack delete permission in some chats; non-fatal.
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- telegram.update`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml src/telegram/telegram.update.ts src/telegram/telegram.update.spec.ts
git commit -m "feat(telegram): add /start /setkeys /deletekeys /status handlers"
```

---

### Task 7: TelegramModule + wire into AppModule + live verification

**Files:**
- Create: `src/telegram/telegram.module.ts`
- Modify: `src/app.module.ts`, `src/config/env.validation.ts`, `.env.example`

- [ ] **Step 1: Create the Telegram module**

Create `src/telegram/telegram.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BinanceModule } from '../binance/binance.module';
import { UsersModule } from '../users/users.module';
import { SetKeysStateStore } from './setkeys.state';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [
    UsersModule,
    BinanceModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.get<string>('TELEGRAM_BOT_TOKEN', { infer: true }) ?? '',
      }),
    }),
  ],
  providers: [TelegramUpdate, SetKeysStateStore],
})
export class TelegramModule {}
```

- [ ] **Step 2: Register the new modules in AppModule**

Replace the contents of `src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { RedisModule } from './common/redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { BinanceModule } from './binance/binance.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule,
    EncryptionModule,
    RedisModule,
    DatabaseModule,
    QueueModule,
    HealthModule,
    UsersModule,
    BinanceModule,
    TelegramModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Make TELEGRAM_BOT_TOKEN required for boot**

The bot can't start without a token. In `src/config/env.validation.ts`, change `TELEGRAM_BOT_TOKEN` from optional to required — replace:

```ts
  @IsString()
  @IsOptional()
  TELEGRAM_BOT_TOKEN?: string;
```

with:

```ts
  @IsString()
  TELEGRAM_BOT_TOKEN!: string;
```

Then update the comment in `.env.example` to note `TELEGRAM_BOT_TOKEN` is now required, and ensure your local `.env` has a real token before booting.

- [ ] **Step 4: Update the e2e env note**

The Foundation health e2e boots the whole `AppModule`, which now includes `TelegramModule`. A fake/empty token would make Telegraf fail to launch. Confirm `test/health.e2e-spec.ts` still passes by ensuring `.env` has a valid `TELEGRAM_BOT_TOKEN` before running, OR (preferred for CI) guard the bot launch: set `TelegrafModule` option `launchOptions: false` when `NODE_ENV === 'test'` in `telegram.module.ts`:

```ts
      useFactory: (config: ConfigService) => ({
        token: config.get<string>('TELEGRAM_BOT_TOKEN', { infer: true }) ?? '',
        launchOptions:
          config.get<string>('NODE_ENV', { infer: true }) === 'test'
            ? false
            : undefined,
      }),
```

This lets the module instantiate (handlers wired) without opening a long-polling connection during tests.

- [ ] **Step 5: Verify build + full unit suite + e2e + lint**

Run: `pnpm run build && pnpm test && pnpm run test:e2e -- health && pnpm run lint`
Expected: build 0; all unit suites pass; health e2e passes (bot launch skipped under `NODE_ENV=test`); lint 0.

- [ ] **Step 6: Live manual verification (real bot + testnet keys)**

With `TELEGRAM_BOT_TOKEN` (from @BotFather), `BINANCE_USE_TESTNET=true`, a Testnet key pair, and Postgres/Redis up:

Run: `pnpm run start:dev`

Then message your bot:
1. `/start` → welcome message; confirm a row: `docker compose exec -T postgres psql -U tradebot -d tradebot -c "select \"telegramId\", username from users;"`
2. `/status` → "not set".
3. `/setkeys` → send Testnet API key, then Testnet secret. Expect each message deleted and a final "connected ✅".
4. Confirm encryption at rest: `docker compose exec -T postgres psql -U tradebot -d tradebot -c "select left(\"binanceApiKey\", 16) from users;"` → base64 ciphertext, **not** plaintext.
5. `/status` → "connected ✅".
6. `/deletekeys` → then `/status` → "not set".

Expected: all six behave as described.

- [ ] **Step 7: Commit**

```bash
git add src/telegram/telegram.module.ts src/app.module.ts src/config/env.validation.ts .env.example
git commit -m "feat(telegram): wire TelegramModule into the app with required bot token"
```

---

## Self-Review

**Spec coverage (sub-plan 2 slice):** `User` model with encrypted key columns ✓ (Task 1) · registration via `/start` ✓ (Task 6) · `/setkeys` AES-encrypted wizard ✓ (Tasks 5–6) · `/deletekeys` ✓ · `/status` API-key health ✓ (Task 6) · keys never logged / never echoed ✓ (handlers reply with status only; secret messages deleted) · `telegramId` as primary identifier, per-user scoping ✓ · Redis `user:{telegramId}:state` wizard state ✓ (Task 5) · testnet-first key validation ✓ (Task 4). Balance/positions/strategies/trading commands are later sub-plans.

**Placeholder scan:** No `TBD`/`add validation`/`handle edge cases`; every code step is complete; every run step states an expected result; the one manual task lists exact messages and DB checks.

**Type/name consistency:** `UsersService` methods (`registerFromTelegram`, `findByTelegramId`, `setBinanceKeys`, `getBinanceCredentials`, `clearBinanceKeys`) match across spec test, implementation, and `TelegramUpdate` usage ✓ · `SetKeysStateStore` (`start`/`setApiKey`/`get`/`clear`) consistent across store, spec, and handlers ✓ · `SetKeysStep` enum values consistent ✓ · `BinanceKeyValidator.validate(apiKey, secret)` consistent across validator, spec, and handler ✓ · `User.telegramId` typed `string` everywhere (entity, service, handlers via `String(ctx.from.id)`) ✓ · `REDIS_CLIENT` and `EncryptionService` reused from Foundation ✓.

**Security review (trading-agent threat model):** secrets validated before storage; deleted from chat; encrypted at rest; never logged (validator logs only failure messages, not keys). Forward note: rate-limiting on `/setkeys` attempts and a per-user command throttle are deferred to the cross-cutting safety sub-plan (9). `ENCRYPTION_KEY` rotation remains unaddressed pending a key-versioning scheme.

**Known follow-ups deferred by design:** real trading client + exchange filters (sub-plan 3); circuit breaker / spend caps / audit log (sub-plan 9).
