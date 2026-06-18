# Telegram Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `TelegramModule` — a long-polling Telegram bot with `/start`, `/setkeys` (two-step wizard), `/status`, `/deletekeys`, `/help` — on top of the existing `UsersModule`, using Telegraf Scenes with a Redis-backed session store.

**Architecture:** `nestjs-telegraf` wraps Telegraf. Stateless commands live in a `@Update()` provider. The `/setkeys` flow is a `@Wizard()` scene whose conversation state persists in Redis (via Telegraf's built-in `session()` middleware given a custom store built on our existing `REDIS_CLIENT`). Handlers call `UsersService` (registration / chat-id → userId) and `BinanceKeyService` (encrypted key custody). Unit tests construct each handler class directly with a mocked Telegraf `ctx` and mocked services — no live bot is launched.

**Tech Stack:** NestJS 11 · nestjs-telegraf · telegraf v4 · ioredis (existing `REDIS_CLIENT`) · Jest.

---

## Reference: existing APIs this plan calls

From `src/users/users.service.ts`:
- `findByChatId(telegramChatId: string): Promise<User | null>`
- `findOrCreate(telegramChatId: string): Promise<User>`

From `src/users/binance-key.service.ts`:
- `upsertKey(userId: string, apiKey: string, secret: string, label?: string): Promise<void>`
- `getActiveKey(userId: string): Promise<{ apiKey: string; secret: string } | null>`
- `deleteKeys(userId: string): Promise<void>`
- **`hasActiveKey(userId: string): Promise<boolean>`** — added in Task 2.

From `src/common/redis/redis.constants.ts`:
- `REDIS_CLIENT` (injection token; the provider is an ioredis `Redis` instance; `RedisModule` is `@Global()`).

`telegramChatId` is the Telegram numeric user id rendered as a string (our `User.telegramChatId` is bigint-as-string).

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via pnpm)

- [ ] **Step 1: Install nestjs-telegraf and telegraf**

Run: `pnpm add nestjs-telegraf telegraf`

Expected: both added to `dependencies`, install completes with no peer-dependency errors.

- [ ] **Step 2: Verify they import**

Run: `node -e "require('telegraf'); require('nestjs-telegraf'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(telegram): add nestjs-telegraf and telegraf"
```

---

## Task 2: Add `hasActiveKey` to BinanceKeyService

So `/status` can check key presence without decrypting the secret.

**Files:**
- Modify: `src/users/binance-key.service.ts`
- Test: `src/users/binance-key.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Add this `describe` block inside the existing top-level `describe('BinanceKeyService', ...)` in `src/users/binance-key.service.spec.ts`, after the `getActiveKey` describe block:

```typescript
  describe('hasActiveKey', () => {
    it('returns true when an active key exists', async () => {
      keyRepo.findOneBy.mockResolvedValue({ id: 'k1' } as BinanceKey);

      await expect(service.hasActiveKey('u1')).resolves.toBe(true);
      expect(keyRepo.findOneBy).toHaveBeenCalledWith({ userId: 'u1', isActive: true });
    });

    it('returns false when no active key exists', async () => {
      keyRepo.findOneBy.mockResolvedValue(null);

      await expect(service.hasActiveKey('u1')).resolves.toBe(false);
    });

    it('does not decrypt anything', async () => {
      keyRepo.findOneBy.mockResolvedValue({ id: 'k1' } as BinanceKey);

      await service.hasActiveKey('u1');

      expect(encryption.decrypt).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- binance-key.service.spec.ts`
Expected: FAIL — `service.hasActiveKey is not a function`.

- [ ] **Step 3: Implement `hasActiveKey`**

Add this method to `BinanceKeyService` in `src/users/binance-key.service.ts`, after `getActiveKey`:

```typescript
  async hasActiveKey(userId: string): Promise<boolean> {
    const key = await this.keyRepo.findOneBy({ userId, isActive: true });
    return key !== null;
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- binance-key.service.spec.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/users/binance-key.service.ts src/users/binance-key.service.spec.ts
git commit -m "feat(users): add BinanceKeyService.hasActiveKey for presence checks"
```

---

## Task 3: Constants + Binance key-format helper

**Files:**
- Create: `src/telegram/telegram.constants.ts`
- Create: `src/telegram/key-format.ts`
- Test: `src/telegram/key-format.spec.ts`

- [ ] **Step 1: Create the constants file**

```typescript
// src/telegram/telegram.constants.ts
export const SETKEYS_SCENE_ID = 'setkeys';

/** Conversation/session TTL — abandoned wizards expire after this. */
export const SESSION_TTL_SECONDS = 15 * 60;

export const HELP_TEXT = [
  'Available commands:',
  '/start — register',
  '/setkeys — connect your Binance API keys',
  '/status — check your setup',
  '/deletekeys — remove stored keys',
  '/help — show this message',
].join('\n');
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/telegram/key-format.spec.ts
import { isPlausibleBinanceKey } from './key-format';

describe('isPlausibleBinanceKey', () => {
  const valid = 'a'.repeat(64);

  it('accepts a 64-char alphanumeric string', () => {
    expect(isPlausibleBinanceKey(valid)).toBe(true);
    expect(isPlausibleBinanceKey('A1b2C3d4'.repeat(8))).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isPlausibleBinanceKey('a'.repeat(63))).toBe(false);
    expect(isPlausibleBinanceKey('a'.repeat(65))).toBe(false);
    expect(isPlausibleBinanceKey('')).toBe(false);
  });

  it('rejects non-alphanumeric characters', () => {
    expect(isPlausibleBinanceKey('-'.repeat(64))).toBe(false);
    expect(isPlausibleBinanceKey(`${'a'.repeat(63)} `)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm test -- key-format.spec.ts`
Expected: FAIL — `Cannot find module './key-format'`.

- [ ] **Step 4: Implement the helper**

```typescript
// src/telegram/key-format.ts

/** Binance API keys and secrets are 64-character alphanumeric strings. */
const BINANCE_KEY_RE = /^[A-Za-z0-9]{64}$/;

export function isPlausibleBinanceKey(value: string): boolean {
  return BINANCE_KEY_RE.test(value);
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm test -- key-format.spec.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/telegram/telegram.constants.ts src/telegram/key-format.ts src/telegram/key-format.spec.ts
git commit -m "feat(telegram): add constants and Binance key-format helper"
```

---

## Task 4: Redis-backed session store

Implements Telegraf's `SessionStore` shape (`get`/`set`/`delete`) on our `REDIS_CLIENT`, keyed `user:{telegramId}:state` with a TTL. It is a plain class (constructed directly in the module factory), so tests `new` it with a mocked Redis client.

**Files:**
- Create: `src/telegram/telegram-session.store.ts`
- Test: `src/telegram/telegram-session.store.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/telegram/telegram-session.store.spec.ts
import { SESSION_TTL_SECONDS } from './telegram.constants';
import { RedisSessionStore } from './telegram-session.store';

const mockRedis = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

describe('RedisSessionStore', () => {
  let redis: ReturnType<typeof mockRedis>;
  let store: RedisSessionStore;

  beforeEach(() => {
    redis = mockRedis();
    store = new RedisSessionStore(redis as never);
  });

  describe('get', () => {
    it('returns the parsed value under the namespaced key', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ step: 2 }));

      await expect(store.get('123')).resolves.toEqual({ step: 2 });
      expect(redis.get).toHaveBeenCalledWith('user:123:state');
    });

    it('returns undefined when the key is absent', async () => {
      redis.get.mockResolvedValue(null);
      await expect(store.get('123')).resolves.toBeUndefined();
    });
  });

  describe('set', () => {
    it('writes JSON with a TTL under the namespaced key', async () => {
      redis.set.mockResolvedValue('OK');

      await store.set('123', { step: 1 });

      expect(redis.set).toHaveBeenCalledWith(
        'user:123:state',
        JSON.stringify({ step: 1 }),
        'EX',
        SESSION_TTL_SECONDS,
      );
    });
  });

  describe('delete', () => {
    it('deletes the namespaced key', async () => {
      redis.del.mockResolvedValue(1);

      await store.delete('123');

      expect(redis.del).toHaveBeenCalledWith('user:123:state');
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- telegram-session.store.spec.ts`
Expected: FAIL — `Cannot find module './telegram-session.store'`.

- [ ] **Step 3: Implement the store**

```typescript
// src/telegram/telegram-session.store.ts
import type { Redis } from 'ioredis';
import { SESSION_TTL_SECONDS } from './telegram.constants';

/**
 * Telegraf SessionStore backed by Redis. Keys are namespaced `user:{name}:state`
 * (the session key is the Telegram user id) and expire after SESSION_TTL_SECONDS.
 */
export class RedisSessionStore {
  constructor(private readonly redis: Redis) {}

  private key(name: string): string {
    return `user:${name}:state`;
  }

  async get(name: string): Promise<unknown> {
    const raw = await this.redis.get(this.key(name));
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  }

  async set(name: string, value: unknown): Promise<void> {
    await this.redis.set(this.key(name), JSON.stringify(value), 'EX', SESSION_TTL_SECONDS);
  }

  async delete(name: string): Promise<void> {
    await this.redis.del(this.key(name));
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- telegram-session.store.spec.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/telegram-session.store.ts src/telegram/telegram-session.store.spec.ts
git commit -m "feat(telegram): add Redis-backed Telegraf session store"
```

---

## Task 5: `/setkeys` wizard scene

A three-step Telegraf wizard: step 1 prompts for the API key, step 2 captures/validates the key, step 3 captures/validates the secret and stores both encrypted. Each captured message is deleted (best-effort) so secrets do not linger in chat history. `/cancel` aborts.

**Files:**
- Create: `src/telegram/scenes/setkeys.wizard.ts`
- Test: `src/telegram/scenes/setkeys.wizard.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/telegram/scenes/setkeys.wizard.spec.ts
import { SetkeysWizard } from './setkeys.wizard';

const VALID = 'a'.repeat(64);

const makeServices = () => ({
  users: { findOrCreate: jest.fn(), findByChatId: jest.fn() },
  keys: { upsertKey: jest.fn() },
});

// Minimal mock of the Telegraf WizardContext surface the wizard touches.
const makeCtx = (text?: string) => ({
  from: { id: 123 },
  message: text === undefined ? undefined : { text, message_id: 7 },
  reply: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(true),
  wizard: { state: {} as Record<string, unknown>, next: jest.fn() },
  scene: { leave: jest.fn().mockResolvedValue(undefined) },
});

describe('SetkeysWizard', () => {
  let services: ReturnType<typeof makeServices>;
  let wizard: SetkeysWizard;

  beforeEach(() => {
    services = makeServices();
    wizard = new SetkeysWizard(services.users as never, services.keys as never);
  });

  describe('step 1 (prompt)', () => {
    it('asks for the API key and advances', async () => {
      const ctx = makeCtx();
      await wizard.step1Prompt(ctx as never);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/API key/i);
      expect(ctx.wizard.next).toHaveBeenCalled();
    });
  });

  describe('step 2 (API key)', () => {
    it('deletes the message, stores the key, and advances on valid input', async () => {
      const ctx = makeCtx(VALID);
      await wizard.step2ApiKey(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(ctx.wizard.state.apiKey).toBe(VALID);
      expect(ctx.wizard.next).toHaveBeenCalled();
    });

    it('re-prompts and does not advance on invalid input', async () => {
      const ctx = makeCtx('too-short');
      await wizard.step2ApiKey(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled(); // still delete, in case it was a real secret
      expect(ctx.wizard.state.apiKey).toBeUndefined();
      expect(ctx.wizard.next).not.toHaveBeenCalled();
      expect(ctx.reply.mock.calls[0][0]).toMatch(/again|invalid/i);
    });
  });

  describe('step 3 (API secret)', () => {
    it('stores encrypted keys and leaves the scene on valid input', async () => {
      services.users.findOrCreate.mockResolvedValue({ id: 'user-uuid' });
      services.keys.upsertKey.mockResolvedValue(undefined);
      const ctx = makeCtx(VALID);
      ctx.wizard.state.apiKey = VALID;

      await wizard.step3Secret(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(services.users.findOrCreate).toHaveBeenCalledWith('123');
      expect(services.keys.upsertKey).toHaveBeenCalledWith('user-uuid', VALID, VALID);
      expect(ctx.scene.leave).toHaveBeenCalled();
    });

    it('re-prompts and does not store on invalid input', async () => {
      const ctx = makeCtx('nope');
      ctx.wizard.state.apiKey = VALID;

      await wizard.step3Secret(ctx as never);

      expect(services.keys.upsertKey).not.toHaveBeenCalled();
      expect(ctx.scene.leave).not.toHaveBeenCalled();
      expect(ctx.reply.mock.calls[0][0]).toMatch(/again|invalid/i);
    });
  });

  describe('onCancel', () => {
    it('leaves the scene', async () => {
      const ctx = makeCtx();
      await wizard.onCancel(ctx as never);

      expect(ctx.scene.leave).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- setkeys.wizard.spec.ts`
Expected: FAIL — `Cannot find module './setkeys.wizard'`.

- [ ] **Step 3: Implement the wizard**

```typescript
// src/telegram/scenes/setkeys.wizard.ts
import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { Scenes } from 'telegraf';
import { UsersService } from '../../users/users.service';
import { BinanceKeyService } from '../../users/binance-key.service';
import { SETKEYS_SCENE_ID } from '../telegram.constants';
import { isPlausibleBinanceKey } from '../key-format';

interface SetkeysState {
  apiKey?: string;
}

type WizardCtx = Scenes.WizardContext & { wizard: { state: SetkeysState } };

@Wizard(SETKEYS_SCENE_ID)
export class SetkeysWizard {
  constructor(
    private readonly users: UsersService,
    private readonly keys: BinanceKeyService,
  ) {}

  @WizardStep(1)
  async step1Prompt(@Ctx() ctx: WizardCtx): Promise<void> {
    await ctx.reply('Send your Binance API key. Send /cancel to abort.');
    ctx.wizard.next();
  }

  @WizardStep(2)
  async step2ApiKey(@Ctx() ctx: WizardCtx): Promise<void> {
    const text = this.extractText(ctx);
    await this.tryDelete(ctx);

    if (!text || !isPlausibleBinanceKey(text)) {
      await ctx.reply('That does not look like a valid API key (64 characters). Try again, or /cancel.');
      return;
    }

    ctx.wizard.state.apiKey = text;
    await ctx.reply('Got it. Now send your Binance API secret.');
    ctx.wizard.next();
  }

  @WizardStep(3)
  async step3Secret(@Ctx() ctx: WizardCtx): Promise<void> {
    const text = this.extractText(ctx);
    await this.tryDelete(ctx);

    if (!text || !isPlausibleBinanceKey(text)) {
      await ctx.reply('That does not look like a valid API secret (64 characters). Try again, or /cancel.');
      return;
    }

    const apiKey = ctx.wizard.state.apiKey;
    if (!apiKey) {
      await ctx.reply('Something went wrong — please start over with /setkeys.');
      await ctx.scene.leave();
      return;
    }

    const user = await this.users.findOrCreate(String(ctx.from!.id));
    await this.keys.upsertKey(user.id, apiKey, text);
    await ctx.reply('Your Binance API keys are saved securely. ✅');
    await ctx.scene.leave();
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: WizardCtx): Promise<void> {
    await ctx.reply('Cancelled. Your keys were not changed.');
    await ctx.scene.leave();
  }

  private extractText(ctx: WizardCtx): string | undefined {
    const message = ctx.message as { text?: string } | undefined;
    return message?.text;
  }

  private async tryDelete(ctx: WizardCtx): Promise<void> {
    try {
      await ctx.deleteMessage();
    } catch {
      // Best effort: in a private chat a bot may delete incoming messages, but if
      // it fails (e.g. message too old) we must not block saving the keys.
    }
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- setkeys.wizard.spec.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/scenes/setkeys.wizard.ts src/telegram/scenes/setkeys.wizard.spec.ts
git commit -m "feat(telegram): add /setkeys wizard scene with secret-message deletion"
```

---

## Task 6: Top-level command handlers (`/start`, `/status`, `/deletekeys`, `/help`, fallback)

**Files:**
- Create: `src/telegram/telegram.update.ts`
- Test: `src/telegram/telegram.update.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/telegram/telegram.update.spec.ts
import { TelegramUpdate } from './telegram.update';

const makeServices = () => ({
  users: { findOrCreate: jest.fn(), findByChatId: jest.fn() },
  keys: { hasActiveKey: jest.fn(), deleteKeys: jest.fn() },
});

const makeCtx = () => ({
  from: { id: 123 },
  reply: jest.fn().mockResolvedValue(undefined),
  scene: { enter: jest.fn().mockResolvedValue(undefined) },
});

describe('TelegramUpdate', () => {
  let services: ReturnType<typeof makeServices>;
  let update: TelegramUpdate;

  beforeEach(() => {
    services = makeServices();
    update = new TelegramUpdate(services.users as never, services.keys as never);
  });

  describe('/start', () => {
    it('registers the user and welcomes them', async () => {
      services.users.findOrCreate.mockResolvedValue({ id: 'u1' });
      const ctx = makeCtx();

      await update.onStart(ctx as never);

      expect(services.users.findOrCreate).toHaveBeenCalledWith('123');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/setkeys/i);
    });
  });

  describe('/setkeys', () => {
    it('enters the setkeys scene', async () => {
      const ctx = makeCtx();
      await update.onSetkeys(ctx as never);
      expect(ctx.scene.enter).toHaveBeenCalledWith('setkeys');
    });
  });

  describe('/status', () => {
    it('prompts /start when the user is not registered', async () => {
      services.users.findByChatId.mockResolvedValue(null);
      const ctx = makeCtx();

      await update.onStatus(ctx as never);

      expect(ctx.reply.mock.calls[0][0]).toMatch(/start/i);
      expect(services.keys.hasActiveKey).not.toHaveBeenCalled();
    });

    it('reports configured keys', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.hasActiveKey.mockResolvedValue(true);
      const ctx = makeCtx();

      await update.onStatus(ctx as never);

      expect(services.keys.hasActiveKey).toHaveBeenCalledWith('u1');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/configured/i);
    });

    it('reports missing keys', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.hasActiveKey.mockResolvedValue(false);
      const ctx = makeCtx();

      await update.onStatus(ctx as never);

      expect(ctx.reply.mock.calls[0][0]).toMatch(/not set/i);
    });
  });

  describe('/deletekeys', () => {
    it('prompts /start when the user is not registered', async () => {
      services.users.findByChatId.mockResolvedValue(null);
      const ctx = makeCtx();

      await update.onDeleteKeys(ctx as never);

      expect(services.keys.deleteKeys).not.toHaveBeenCalled();
      expect(ctx.reply.mock.calls[0][0]).toMatch(/start/i);
    });

    it('deletes stored keys for a registered user', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.deleteKeys.mockResolvedValue(undefined);
      const ctx = makeCtx();

      await update.onDeleteKeys(ctx as never);

      expect(services.keys.deleteKeys).toHaveBeenCalledWith('u1');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/removed/i);
    });
  });

  describe('/help and fallback', () => {
    it('replies with help text listing commands', async () => {
      const ctx = makeCtx();
      await update.onHelp(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/\/setkeys/);
    });

    it('nudges unknown text toward /help', async () => {
      const ctx = makeCtx();
      await update.onText(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/help/i);
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- telegram.update.spec.ts`
Expected: FAIL — `Cannot find module './telegram.update'`.

- [ ] **Step 3: Implement the update handler**

```typescript
// src/telegram/telegram.update.ts
import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import type { Context, Scenes } from 'telegraf';
import { UsersService } from '../users/users.service';
import { BinanceKeyService } from '../users/binance-key.service';
import { HELP_TEXT, SETKEYS_SCENE_ID } from './telegram.constants';

type SceneCtx = Scenes.SceneContext;

@Update()
export class TelegramUpdate {
  constructor(
    private readonly users: UsersService,
    private readonly keys: BinanceKeyService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await this.users.findOrCreate(String(ctx.from!.id));
    await ctx.reply(
      'Welcome to the trading bot. Run /setkeys to connect your Binance account, then /status to check it.',
    );
  }

  @Command('setkeys')
  async onSetkeys(@Ctx() ctx: SceneCtx): Promise<void> {
    await ctx.scene.enter(SETKEYS_SCENE_ID);
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context): Promise<void> {
    const user = await this.users.findByChatId(String(ctx.from!.id));
    if (!user) {
      await ctx.reply('You are not registered yet. Send /start first.');
      return;
    }
    const configured = await this.keys.hasActiveKey(user.id);
    await ctx.reply(
      `API keys: ${configured ? 'configured ✅' : 'not set — run /setkeys'}\nStrategies: coming soon`,
    );
  }

  @Command('deletekeys')
  async onDeleteKeys(@Ctx() ctx: Context): Promise<void> {
    const user = await this.users.findByChatId(String(ctx.from!.id));
    if (!user) {
      await ctx.reply('You are not registered yet. Send /start first.');
      return;
    }
    await this.keys.deleteKeys(user.id);
    await ctx.reply('Your stored API keys have been removed.');
  }

  @Help()
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(HELP_TEXT);
  }

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply('Unrecognized message. Send /help to see what I can do.');
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- telegram.update.spec.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/telegram.update.ts src/telegram/telegram.update.spec.ts
git commit -m "feat(telegram): add /start /status /deletekeys /help command handlers"
```

---

## Task 7: TelegramModule wiring + AppModule registration

Wires Telegraf with the token (fail-fast if missing), the Redis session store, a global error catch, and registers the scene + update providers. Then registers `TelegramModule` in `AppModule`.

**Files:**
- Create: `src/telegram/telegram.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/telegram/telegram.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectBot, TelegrafModule } from 'nestjs-telegraf';
import { session, Telegraf } from 'telegraf';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.constants';
import { UsersModule } from '../users/users.module';
import { RedisSessionStore } from './telegram-session.store';
import { SetkeysWizard } from './scenes/setkeys.wizard';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [
    UsersModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN', { infer: true });
        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is required to start the Telegram bot');
        }
        const store = new RedisSessionStore(redis);
        return {
          token,
          middlewares: [
            session({
              store,
              getSessionKey: (ctx) => (ctx.from ? String(ctx.from.id) : undefined),
            }),
          ],
        };
      },
    }),
  ],
  providers: [TelegramUpdate, SetkeysWizard],
})
export class TelegramModule {
  constructor(@InjectBot() private readonly bot: Telegraf) {
    // Global safety net: a throwing handler must never crash the bot process.
    this.bot.catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[telegram] handler error', err);
    });
  }
}
```

- [ ] **Step 2: Register TelegramModule in AppModule**

Replace `src/app.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { RedisModule } from './common/redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
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
    TelegramModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Build and run the full test suite**

Run: `pnpm build && pnpm test`
Expected: build exits 0; all test suites pass (existing + new telegram specs). No live Telegram connection is made by the unit tests.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/telegram.module.ts src/app.module.ts
git commit -m "feat(telegram): wire TelegramModule (Telegraf + Redis session) into AppModule"
```

---

## Task 8: Manual smoke test (human-run, optional but recommended)

Automated tests mock Telegram; this confirms the bot actually talks to Telegram. Requires the running Postgres (5433) + Redis (6380) containers and a valid `TELEGRAM_BOT_TOKEN` in `.env`.

- [ ] **Step 1: Start dependencies and the app**

```bash
docker compose up -d
pnpm start:dev
```
Expected: app boots with no `TELEGRAM_BOT_TOKEN` error and no ioredis ECONNREFUSED; logs show Nest started.

- [ ] **Step 2: Drive the bot from Telegram**

In the Telegram chat with your bot:
1. `/start` → welcome message mentioning `/setkeys`.
2. `/status` → "API keys: not set".
3. `/setkeys` → prompts for key; send a 64-char test key (it should be deleted from the chat); prompts for secret; send a 64-char test secret (deleted); confirms saved.
4. `/status` → "API keys: configured ✅".
5. `/deletekeys` → "removed". `/status` → "not set" again.
6. `/setkeys` then `/cancel` mid-flow → "Cancelled".

Expected: each step behaves as described; secret-bearing messages disappear from the chat.

(No commit — this task is verification only.)

---

## Self-Review

**Spec coverage** (against `2026-06-16-telegram-skeleton-design.md`):
- §2 module structure → Tasks 3–7 create `telegram.constants.ts`, `key-format.ts`, `telegram-session.store.ts`, `scenes/setkeys.wizard.ts`, `telegram.update.ts`, `telegram.module.ts`. ✅
- §3 token fail-fast + optional env + Redis session + AppModule registration → Task 7. ✅
- §4 `/start`, `/setkeys` wizard, `/status`, `/deletekeys`, `/help`, user-resolution (`findOrCreate`/`findByChatId` → userId) → Tasks 5, 6. ✅
- §4 `/status` without decrypting secret → Task 2 (`hasActiveKey`). ✅
- §5 format-only validation, no `username`, open registration, secrets deleted/never logged → Tasks 3, 5. ✅
- §6 error handling: `/cancel`, TTL expiry, invalid-input re-prompt, unknown-text nudge, global catch, missing-keys messaging → Tasks 4 (TTL), 5 (cancel/reprompt), 6 (unknown text, missing-keys), 7 (global catch). ✅
- §7 testing: handlers via mocked ctx, wizard steps, session store → Tasks 4, 5, 6. ✅
- §8 deps `nestjs-telegraf`, `telegraf` → Task 1. ✅
- §9 acceptance criteria → covered across Tasks 5–8.

**Placeholder scan:** No TBDs; every code/test step has complete content.

**Type/name consistency:** `hasActiveKey` (Task 2) matches its use in Task 6. `SETKEYS_SCENE_ID` ('setkeys') is defined in Task 3 and used in Tasks 5–6 (the update test asserts `'setkeys'`). `SESSION_TTL_SECONDS` defined in Task 3, used in Task 4 store + test. `RedisSessionStore` constructor `(redis: Redis)` matches Task 4 test and Task 7 factory. Wizard method names `step1Prompt`/`step2ApiKey`/`step3Secret`/`onCancel` match between Task 5 impl and test. `TelegramUpdate` method names `onStart`/`onSetkeys`/`onStatus`/`onDeleteKeys`/`onHelp`/`onText` match between Task 6 impl and test.

**Implementation note (flagged for the implementer):** `@WizardStep` indices (1/2/3) and automatic scene/stage registration are `nestjs-telegraf`-version-specific. The unit tests call wizard/update methods directly and do not depend on Telegraf's step cursor or stage wiring, so they pass regardless. If the manual smoke test (Task 8) shows step routing is off (e.g. the version is 0-indexed, or scenes need explicit `TELEGRAF_STAGE` registration), adjust the step indices / add stage wiring in `telegram.module.ts` — this does not affect the unit tests. Report back if this occurs.
