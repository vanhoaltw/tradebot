# Telegram Skeleton Design Spec

**Date:** 2026-06-16
**Sub-plan:** 1 of 8 (vertical-slice-first build order)
**Stack:** NestJS 11 · `nestjs-telegraf` (Telegraf, long polling) · Redis (session store) · existing `UsersModule`
**Parent spec:** `docs/superpowers/specs/2026-06-15-tradebot-design.md`

---

## 1. Goal

Deliver a usable Telegram bot covering account setup: users can register, store their Binance API keys through a secure multi-step wizard, check status, and remove keys. This slice establishes the reusable Telegraf **Scenes + Redis session** wizard backbone that every later wizard (`/newstrategy`, `/edit`) reuses.

Out of scope for this slice: live Binance key verification, balance/trading commands, strategies, AI. Those arrive in later sub-plans.

---

## 2. Architecture

**Pattern:** A `TelegramModule` feature module added to the modular monolith. Transport is Telegram **long polling** via `nestjs-telegraf` — no public URL required.

**Conversation state:** Telegraf's built-in `WizardScene` + session middleware, backed by the existing `REDIS_CLIENT` (ioredis). Session is keyed by `user:{telegramId}:state` (per parent spec §4) with a TTL so abandoned wizards expire.

**Dependencies:** `TelegramModule` imports `UsersModule`, which already exports `UsersService` (registration) and `BinanceKeyService` (encrypted key custody with active-key rotation).

### Module structure (`src/telegram/`)

```
telegram/
├── telegram.module.ts            # TelegrafModule.forRootAsync (token + Redis session middleware)
├── telegram.update.ts            # Top-level commands: /start, /status, /deletekeys, /help, /cancel
├── scenes/
│   └── setkeys.wizard.ts         # WizardScene: prompt apiKey → prompt secret → validate/encrypt/store
└── telegram-session.provider.ts  # Redis-backed session store built on REDIS_CLIENT
```

Each unit has one responsibility: `telegram.update.ts` routes stateless commands; `setkeys.wizard.ts` owns the stateful key-entry flow; `telegram-session.provider.ts` adapts ioredis to a Telegraf session store; `telegram.module.ts` wires them together.

---

## 3. Configuration & Wiring

- `TelegrafModule.forRootAsync` reads `TELEGRAM_BOT_TOKEN` from `ConfigService`. The module **fails fast at boot** if the token is missing or empty.
- `env.validation` keeps `TELEGRAM_BOT_TOKEN` **optional** (so non-Telegram contexts such as the test suite still boot); presence is enforced by the Telegram module itself at startup.
- Session middleware uses the existing `REDIS_CLIENT` provider (no new Redis connection). Session entries carry a TTL (default: 15 minutes) so half-finished wizards expire.
- `TelegramModule` is registered in `AppModule` imports.

---

## 4. Commands (this slice)

**User resolution:** Telegram delivers a `telegramChatId`, but `BinanceKeyService` keys off our internal `userId` (UUID). Every command that touches keys first resolves the user via `UsersService` (`findOrCreate` for `/setkeys`, `findByChatId` for `/status` and `/deletekeys`) to obtain `userId`. A command on an unregistered chat where a user record is required falls back to prompting `/start`.

### `/start`
- Calls `UsersService.findOrCreate(telegramChatId)` (idempotent registration).
- Replies with a welcome message and a next-step hint (run `/setkeys`).

### `/setkeys` — WizardScene
1. **Step 1 — API key:** prompt "Send your Binance API key." On the user's reply:
   - **Delete the user's message** (so the key isn't left in chat history).
   - Basic-validate: non-empty, plausible length/charset. On failure, re-prompt the same step with a hint (do not advance).
   - Stash the key in scene state; advance to step 2.
2. **Step 2 — API secret:** prompt "Send your Binance API secret." On the user's reply:
   - **Delete the user's message.**
   - Validate as in step 1.
   - Call `BinanceKeyService.upsertKey(userId, apiKey, secret)` (AES-256-GCM encrypt on write, deactivates any prior active key).
   - Leave the scene; confirm success.
- `/cancel` at any step aborts the wizard and clears scene state.

### `/status`
- Shows whether keys are configured: `BinanceKeyService.getActiveKey(userId)` non-null → "API keys: configured" (plus label/created date if available); null → "API keys: not set — run /setkeys".
- Shows a "Strategies: coming soon" placeholder (strategies module does not exist yet).

### `/deletekeys`
- Calls `BinanceKeyService.deleteKeys(userId)`; confirms. Handles the "no keys stored" case with a clear message, not an error.

### `/help`
- Lists the commands available in this slice.

---

## 5. Scope Boundaries & Decisions

- **Format-only key validation.** `/setkeys` checks that key/secret are well-formed but does **not** call Binance to verify them — the Binance client lives in the trading sub-plan. Live verification and a real `/status` "key health" check are added there. This slice stores keys correctly and securely; it does not yet prove they trade.
- **`username` not captured.** The parent spec's `User` has a `username` column; our `User` entity does not, and nothing in this slice needs it. Per the roadmap decision to keep our split `User` + `BinanceKey` data model, no column/migration is added just for display.
- **Open registration.** Anyone messaging the bot can `/start` (multi-user by design). `UserRole` (admin/user) exists but no command in this slice gates on it.
- **Secrets never echoed or logged.** The wizard deletes the user's messages containing the key/secret immediately after reading them; no code path logs plaintext (consistent with parent spec §9 and `EncryptionService`).

---

## 6. Error Handling

- **Wizard interruptions:** `/cancel` aborts any step and clears scene state. A top-level command sent mid-wizard is handled gracefully rather than swallowed as wizard input.
- **Abandoned wizards:** the Redis session key's TTL expires a half-finished `/setkeys` instead of trapping the user.
- **Invalid input:** failed format validation re-prompts the same step with a hint; it does not crash the scene or advance.
- **Unknown commands / plain text** outside a wizard → a short "try /help" reply.
- **Global catch:** a Telegraf error handler ensures a throwing handler never takes the bot process down; the user gets a generic "something went wrong" message and the error is logged **without secrets**.
- **Missing keys:** `/status` and `/deletekeys` handle the "no keys stored yet" case with clear messaging, not an error.

---

## 7. Testing

All external I/O is mocked — no live Telegram or Binance calls; the Telegraf instance is not launched in tests.

- **Command handlers:** unit-tested with a mocked Telegraf `ctx`. Assert `/start` calls `findOrCreate`; `/status` reflects key-present vs key-absent; `/deletekeys` calls `deleteKeys` and handles the no-keys case.
- **Wizard:** simulate both steps with a mocked `ctx`/scene. Assert message-delete is called on each secret-bearing message, `upsertKey` is called exactly once with the collected key + secret, `/cancel` leaves the scene without storing, and invalid input re-prompts without advancing.
- **Session provider:** tested against a mocked Redis client (set/get/TTL behavior).

---

## 8. New Package Dependencies

```
nestjs-telegraf     # NestJS wrapper for Telegraf
telegraf            # Telegram bot framework (Scenes, session, long polling)
```

(`ioredis` and `@nestjs/config` already present.)

---

## 9. Acceptance Criteria

- `/start` registers a new Telegram user and is idempotent on repeat.
- `/setkeys` collects API key + secret across two messages, deletes both secret-bearing messages, stores them encrypted via `BinanceKeyService.upsertKey`, and confirms.
- `/cancel` aborts the wizard cleanly at either step.
- `/status` correctly distinguishes configured vs not-configured keys.
- `/deletekeys` removes stored keys and handles the no-keys case.
- A handler error never crashes the bot process.
- Full test suite passes with all external services mocked.
