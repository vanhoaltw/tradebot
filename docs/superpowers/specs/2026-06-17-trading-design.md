# Trading Design Spec

**Date:** 2026-06-17
**Sub-plan:** 2 of 8 (vertical-slice-first build order)
**Stack:** NestJS 11 · `@binance/connector` (Binance Spot **testnet**) · TypeORM/PostgreSQL · existing `UsersModule` + `nestjs-telegraf`
**Parent spec:** `docs/superpowers/specs/2026-06-15-tradebot-design.md`

---

## 1. Goal

Give a registered user with stored Binance keys the ability to trade Binance Spot **testnet** from Telegram: check balances, place a market buy (with a protective OCO), and market sell. Every executed order is persisted as a `Trade` for later `/history`, `/pnl`, and daily-limit features.

Out of scope for this slice: `/positions`, `/pnl`, `/history`, `/cancelbuy`, `/cancelsell`, daily-spend limit, live (non-testnet) trading, and any strategy/AI automation.

---

## 2. Decisions (locked during brainstorming)

- **Testnet only**, enforced at the client layer: `BinanceClientFactory` hardcodes the Spot **testnet** base URL. There is no code path to production this slice; going live later is a deliberate, gated change.
- **Order execution follows parent spec §6 exactly** (see §5 below).
- **Protective OCO on every `/buy`** with **fixed** levels: stop-loss **5%**, take-profit **10%** (constants in code).
- **Trades are persisted** (`Trade` entity + migration, per parent spec §3).
- **Per-order cap enforced**: `/buy` rejects amounts above `MAX_SINGLE_ORDER_USDT`. The daily-spend cap (`MAX_DAILY_SPEND_USDT`) is deferred (needs trade history).
- **No trade confirmation step** (testnet money); `/buy`/`/sell` execute directly.
- Client library: **`@binance/connector`** (`Spot`). It has weak TypeScript types, so `BinanceService` is the single typed boundary; exact method signatures are confirmed against the installed version when writing the plan.

---

## 3. Architecture

A `TradingModule` feature module, imported into `AppModule`. It imports `UsersModule` (for `UsersService` + `BinanceKeyService`). It adds a second `@Update()` provider (`TradingUpdate`) — `nestjs-telegraf` supports multiple update providers, keeping `telegram/` focused on account/setup and `trading/` owning trade commands.

### Module structure (`src/trading/`)
```
trading/
├── trading.module.ts          # wires providers; imports UsersModule; registers Trade entity
├── binance-client.factory.ts  # build a per-user @binance/connector Spot client, TESTNET base URL hardcoded
├── binance.service.ts         # typed ops on a client: balances, filters, price, market buy/sell, OCO, cancel
├── precision.ts               # pure: roundToStep (floor to lot), roundToTick
├── symbol.ts                  # pure: normalizeSymbol('btc') → 'BTCUSDT'
├── trade-args.ts              # pure: parseBuyArgs / parseSellArgs
├── trade.entity.ts            # Trade (persisted)
├── trades.service.ts          # record() and lookups of Trade rows
├── trading.service.ts         # orchestration: cap → keys → client → execute → persist → OCO
└── trading.update.ts          # @Update() with /balance /buy /sell
```

Each unit has one responsibility. `binance.service.ts` is the only place that touches the SDK, so tests mock a single seam. The pure helpers (`precision`, `symbol`, `trade-args`) hold the fiddly logic and are exhaustively unit-tested without any Telegram/Binance runtime.

---

## 4. Binance client & per-user keys

- **`BinanceClientFactory.create(apiKey, secret)`** returns a `Spot` instance configured with `baseURL = 'https://testnet.binance.vision'`. Live trading is structurally impossible this slice.
- Keys are **per-user**. `TradingService` resolves the user, calls `BinanceKeyService.getActiveKey(userId)` (decrypts), and builds a client for that request. If `getActiveKey` returns `null`, commands reply "You have not connected Binance keys yet — run /setkeys first." (no error thrown).
- **`BinanceService`** wraps the connector into typed methods, each taking a `Spot` client:
  - `getBalances(client)` → `{ asset, free }[]` (non-zero balances)
  - `getSymbolFilters(client, symbol)` → `{ stepSize, tickSize, minQty, minNotional }`
  - `getPrice(client, symbol)` → current price (number)
  - `marketBuy(client, symbol, quantity)` → `{ orderId, executedQty, avgPrice }`
  - `marketSell(client, symbol, quantity)` → `{ orderId, executedQty, avgPrice }`
  - `placeOcoSell(client, symbol, quantity, takeProfitPrice, stopPrice, stopLimitPrice)` → `{ orderListId }`
  - `cancelOpenOrders(client, symbol)` → number of orders cancelled

---

## 5. Order execution (parent spec §6, verbatim flow)

### `/buy <symbol> <usdt>` — `TradingService.buy(userId, symbol, usdt)`
1. **Per-order cap:** reject if `usdt > MAX_SINGLE_ORDER_USDT`.
2. Resolve keys → build testnet client. No keys → friendly /setkeys nudge.
3. `normalizeSymbol`; fetch symbol filters.
4. **Check balance:** fetch free USDT; reject if `usdt >` free USDT.
5. **qty = amountUsdt / price:** fetch current price, compute quantity, round **down** to stepSize. Reject if `qty < minQty` or `usdt < minNotional`.
6. **Market order** (BUY by quantity); read avg fill price from the response.
7. **Persist** a `Trade` (side BUY, status FILLED, qty, avgPrice, binanceOrderId, filledAt).
8. **Place OCO (SL+TP):** OCO SELL of the filled qty; `takeProfitPrice = avg × 1.10`, `stopPrice = avg × 0.95`, `stopLimitPrice = stopPrice × 0.999`, all rounded to tickSize. **Best-effort:** the buy is already irreversible, so if the OCO is rejected (precision, minNotional, or fees shaved the base balance below the filled qty) the command does **not** fail — it reports the fill plus an explicit "⚠️ unprotected position" warning.
9. **Reply** with the fill and the OCO outcome.

### `/sell <symbol> <usdt|all>` — `TradingService.sell(userId, symbol, amount)`
1. Resolve keys/client; `normalizeSymbol`.
2. **Cancel existing OCO:** cancel open orders for the symbol first (per §6).
3. **Determine quantity:** `all` → free base-asset balance; `<usdt>` → `usdt / price` rounded **down** to stepSize. Reject below `minQty`/`minNotional`.
4. **Market sell** by quantity.
5. **Persist** a `Trade` (side SELL, status FILLED); reply with the fill.

### Precision (`precision.ts`, pure)
- `roundToStep(value, stepSize)` — floor to the lot step (never sell/buy more than intended).
- `roundToTick(price, tickSize)` — round price to the tick grid.
These prevent Binance `LOT_SIZE` / `PRICE_FILTER` rejections.

---

## 6. Data model — `Trade` (parent spec §3)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, `gen_random_uuid()` |
| user_id | uuid | references users(id) ON DELETE CASCADE |
| strategy_id | uuid | **nullable**, no FK yet (strategies module does not exist); always null for manual trades |
| symbol | varchar | e.g. BTCUSDT |
| side | enum `trade_side_enum` | BUY · SELL |
| quantity | numeric | base-asset amount (TypeORM returns numeric as string) |
| price | numeric | fill price |
| status | enum `trade_status_enum` | PENDING · FILLED · CANCELLED · FAILED |
| binance_order_id | varchar | nullable |
| filled_at | timestamptz | nullable |
| created_at | timestamptz | default NOW() |

Migration creates `trade_side_enum`, `trade_status_enum`, the `trades` table, and an index on `user_id`. `TradesService.record(...)` writes rows; a Binance order rejection persists a **FAILED** Trade for the audit trail.

---

## 7. Telegram commands (`trading.update.ts`)

A `@Update()` provider with:
- **`/balance`** → `TradingService.getBalances(userId)` → reply listing non-zero balances (asset + free), USDT first. No keys → /setkeys nudge.
- **`/buy <symbol> <usdt>`** → `parseBuyArgs` → `TradingService.buy` → reply with fill + OCO outcome.
- **`/sell <symbol> <usdt|all>`** → `parseSellArgs` → `TradingService.sell` → reply with fill.

### Argument parsing (`trade-args.ts`, pure)
- `parseBuyArgs(text)` → `{ symbol, usdt }` or a descriptive error (missing args, non-numeric or ≤ 0 amount).
- `parseSellArgs(text)` → `{ symbol, amount: number | 'all' }` or error.

---

## 8. Error Handling

- **No keys** → friendly "/setkeys" nudge (not an error).
- **Bad arguments** → reply a usage hint (`Usage: /buy <symbol> <usdt>`).
- **Per-order cap exceeded / insufficient balance / below minNotional or minQty** → clear, specific rejection; no order submitted.
- **Binance rejects the order** → catch, reply the Binance reason, persist a **FAILED** `Trade`.
- **OCO fails after a filled buy** → the fill succeeds; reply warns of the unprotected position.
- The global `bot.catch` (from `TelegramModule`) remains the last-resort crash guard.
- Secrets are never logged; keys are decrypted only in-memory at execution time.

---

## 9. Testing

All external I/O is mocked — no live Binance, no live Telegram; no migration-dependent tests beyond the migration run itself.

- **Pure units** (`precision`, `symbol`, `trade-args`): exhaustive table-style tests.
- **`BinanceService`**: mock the `@binance/connector` `Spot` client; assert correct call params (market order by computed quantity, OCO prices rounded to tick, cancel-open-orders on sell).
- **`TradingService`**: mock `BinanceService` + `BinanceKeyService` + `TradesService`; assert cap enforcement, balance check, qty computation, Trade persistence, OCO best-effort path, FAILED-on-rejection, and the no-keys path.
- **`TradesService`**: mock the repository; assert `record()` writes the correct row.
- **`TradingUpdate`**: mock `ctx` + `TradingService`; assert each command's happy and error replies.
- **`Trade` migration**: runs against the testnet Postgres container (as the users migration did).

---

## 10. New Package Dependencies

```
@binance/connector     # Binance Spot REST client (testnet base URL)
```

(`@nestjs/typeorm`, `pg`, `nestjs-telegraf`, `class-validator` already present.)

---

## 11. Acceptance Criteria

- `/balance` lists the user's non-zero testnet balances; nudges to /setkeys when keys are absent.
- `/buy BTC 50` (within the cap, sufficient balance) places a testnet market buy, persists a FILLED Trade, and places a protective OCO (SL 5% / TP 10%) — or reports an unprotected position if the OCO is rejected.
- `/buy` rejects amounts over `MAX_SINGLE_ORDER_USDT`, amounts exceeding free USDT, and sub-minNotional amounts, without submitting an order.
- `/sell BTC all` cancels resting orders for the symbol then market-sells the full base balance and persists a FILLED Trade; `/sell BTC 25` sells ~25 USDT worth.
- A Binance rejection persists a FAILED Trade and replies with the reason.
- The full test suite passes with all external services mocked.
