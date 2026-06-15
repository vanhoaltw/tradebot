# Tradebot Design Spec

**Date:** 2026-06-15
**Stack:** NestJS 11 · TypeScript · PostgreSQL (Neon) · Redis · Telegram · Binance Spot · Claude API

---

## 1. Overview

A multi-user Telegram-controlled trading bot for Binance Spot markets. Users register via Telegram, store their Binance API keys, configure automated strategies, and receive trade notifications — all through Telegram. An AI layer (Claude API) analyzes news, technical indicators, and orderbook data to generate BUY/SELL/HOLD signals. User configuration always overrides AI decisions via a 7-level priority system.

---

## 2. Architecture

**Pattern:** Modular Monolith — single NestJS process with clearly bounded feature modules.

**Transport:** Telegram long polling via `nestjs-telegraf` (no public URL required).

**Async work:** BullMQ on Redis — strategy tick jobs, AI analysis jobs, notification jobs.

**Modules:**

```
src/
├── telegram/          # Bot handlers, wizards, command routing
├── users/             # Registration, API key management
├── strategies/        # Strategy CRUD, config validation, BullMQ scheduling
├── trading/           # Order execution, Binance REST client
├── ai/                # Claude API integration, prompt builder, escalation logic
├── market-data/       # Binance WebSocket orderbook, candle fetching, indicator calc
├── news/              # CryptoPanic + RSS feed fetcher, sentiment pre-filter
├── notifications/     # Telegram notification dispatcher
├── pnl/               # P&L snapshots, reporting
└── common/            # Encryption, Redis client, config, decorators
```

---

## 3. Data Models (PostgreSQL via TypeORM)

### User
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| telegramId | bigint | unique |
| username | varchar | Telegram username |
| binanceApiKey | varchar | AES-256-GCM encrypted |
| binanceSecretKey | varchar | AES-256-GCM encrypted |
| isActive | boolean | default true |
| createdAt | timestamp | |

### Strategy
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid | FK → User |
| name | varchar | user-defined label |
| type | enum | DCA · GRID · EMA · RSI · CUSTOM · AI_NEWS · AI_COMBINED · AI_FULL |
| config | jsonb | strategy-specific config object |
| isActive | boolean | |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### Trade
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid | FK → User |
| strategyId | uuid | FK → Strategy (nullable for manual trades) |
| symbol | varchar | e.g. BTCUSDT |
| side | enum | BUY · SELL |
| quantity | decimal | |
| price | decimal | fill price |
| status | enum | PENDING · FILLED · CANCELLED · FAILED |
| binanceOrderId | varchar | |
| filledAt | timestamp | nullable |
| createdAt | timestamp | |

### PnlSnapshot
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid | FK → User |
| date | date | daily snapshot |
| totalInvested | decimal | |
| currentValue | decimal | |
| unrealizedPnl | decimal | |
| realizedPnl | decimal | |

---

## 4. Redis Key Schema

| Key | TTL | Purpose |
|---|---|---|
| `user:{telegramId}:state` | session | Wizard conversation state |
| `user:{telegramId}:session` | 60s | Cached balance + last trade |
| `strategy:{strategyId}:lock` | 14m | Prevents duplicate BullMQ ticks |
| `orderbook:{symbol}` | 5s | Real-time orderbook snapshot from WebSocket |
| `news:{symbol}:cache` | 60m | Cached news headlines + sentiment to avoid re-analysis |
| `ai:cooldown:{userId}:{strategyId}` | cooldownMinutes | Prevents over-trading |

---

## 5. Strategy Types & Configs

### DCA (Dollar Cost Averaging)
```json
{
  "symbol": "BTCUSDT",
  "baseOrderUsdt": 20,
  "dcaOrderUsdt": 10,
  "maxDcaOrders": 5,
  "priceDeviationPercent": 2.0,
  "priceDeviationMultiplier": 1.0,
  "dcaSizeMultiplier": 1.0,
  "takeProfitPercent": 3.0,
  "takeProfitMode": "FIXED",
  "stopLossPercent": 10.0,
  "cooldownSeconds": 60
}
```

### Grid
```json
{
  "symbol": "ETHUSDT",
  "lowerPrice": 2000,
  "upperPrice": 3000,
  "gridCount": 10,
  "gridType": "ARITHMETIC",
  "totalUsdt": 200,
  "stopLossPrice": 1800,
  "takeProfitPrice": 3200
}
```

### AI_FULL (most capable AI strategy)
```json
{
  "watchlist": ["BTCUSDT", "ETHUSDT"],
  "timeframe": "15m",
  "indicators": ["RSI", "EMA", "MACD", "BB"],
  "lookbackCandles": 50,
  "amountUsdt": 50,
  "minConfidence": 0.78,
  "maxRiskLevel": "MEDIUM",
  "maxPositionUsdt": 500,
  "stopLossPercent": 5.0,
  "takeProfitPercent": 10.0,
  "tradeOnlyBetween": "08:00-22:00",
  "cooldownMinutes": 30,
  "blacklistWords": ["hack", "exploit", "SEC lawsuit"],
  "analysisIntervalMinutes": 15,
  "useOrderbook": true,
  "orderbookDepth": 20,
  "minBidAskSpreadPercent": 0.005,
  "avoidThinOrderbook": true,
  "imbalanceThreshold": 0.60
}
```

AI_NEWS uses news only (no indicators, no orderbook). AI_COMBINED uses news + indicators but no orderbook.

---

## 6. AI Decision Flow

```
TRIGGER (BullMQ, every analysisIntervalMinutes)
    │
    ▼
PRE-FLIGHT CHECKS
  • Strategy + user active?
  • Within tradeOnlyBetween hours?
  • Cooldown expired? (Redis TTL)
  • No duplicate job running? (strategy lock)
    │ ALL PASS
    ▼
DATA GATHERING (parallel)
  [A] Binance REST → OHLCV candles → RSI / EMA / MACD / BB
  [B] CryptoPanic + RSS → top 10 headlines → pre-filter blacklist
  [C] Redis orderbook:{symbol} → spread + imbalance ratio
    │
    ▼
BLACKLIST KEYWORD CHECK
  Any headline matches blacklistWords? → HOLD + notify + stop
    │ CLEAN
    ▼
AI ANALYSIS (claude-haiku-4-5)
  ~950 input tokens · ~200 output tokens
  Output: { action, confidence, riskLevel, reasoning }
    │
    ▼
CONFIDENCE GATE
  < minConfidence          → HOLD
  borderline (within 5%)  → escalate to claude-sonnet-4-6, re-run
  ≥ minConfidence          → continue
    │
    ▼
USER OVERRIDE PRIORITY (P1 wins, first match stops)
  P1  Manual Telegram override active?     → execute that command
  P2  Hard stop-loss hit?                  → force SELL
  P3  Take-profit target hit?              → force SELL
  P4  BUY would exceed maxPositionUsdt?    → downsize or HOLD
  P5  riskLevel > maxRiskLevel?            → HOLD
  P6  Orderbook too thin / spread too wide? → HOLD
  P7  AI decision passes all checks        → proceed
    │
    ▼
EXECUTION
  BUY:  check balance → qty = amountUsdt / price → market order → OCO (SL+TP)
  SELL: cancel existing OCO → market sell
  HOLD: log reason, no order
    │
    ▼
POST-EXECUTION
  • Write Trade → PostgreSQL
  • Update PnlSnapshot → PostgreSQL
  • Send Telegram notification → user
  • Release strategy lock
  • Set cooldown TTL
```

---

## 7. API Cost Estimate

**Primary model:** `claude-haiku-4-5` ($1.00/$5.00 per MTok in/out)
**Escalation model:** `claude-sonnet-4-6` ($3.00/$15.00 per MTok in/out) — ~5-10% of calls

| User type | Monthly cost |
|---|---|
| Light (1 symbol, AI_NEWS, 14h/day) | ~$2.50 |
| Standard (2 symbols, AI_FULL, 14h/day) | ~$8.60 |
| Heavy (5 symbols, AI_FULL, 14h/day) | ~$21.50 |

**Cost controls:**
- News headline cache 60 min (TTL Redis) — same articles not re-analyzed
- Daily AI call budget cap per user (configurable, default ~150 calls/day)
- Cooldown gate skips analysis when last signal was recent
- Non-AI strategies (DCA, Grid, EMA+RSI) default for new users — zero AI cost

---

## 8. Telegram Commands

### Account & Setup
| Command | Description |
|---|---|
| `/start` | Register, show welcome |
| `/setkeys` | Wizard: save Binance API key + secret (AES-encrypted) |
| `/deletekeys` | Remove stored API keys |
| `/status` | API key health, active strategy count |

### Balance & Portfolio
| Command | Description |
|---|---|
| `/balance` | USDT + coin balances from Binance |
| `/positions` | Open positions with entry price, current PnL% |
| `/pnl` | P&L summary (today / 7d / 30d / all-time) |
| `/history` | Last 20 trades |

### Strategy Management
| Command | Description |
|---|---|
| `/newstrategy` | Step-by-step wizard to create a strategy |
| `/strategies` | List all strategies with status |
| `/strategy <id>` | Full config + performance stats |
| `/pause <id>` | Pause strategy (stops BullMQ job) |
| `/resume <id>` | Resume paused strategy |
| `/delete <id>` | Delete strategy (confirmation required) |
| `/edit <id>` | Edit config via wizard |
| `/recommend` | AI recommends strategies based on current market |

### Manual Trading & Overrides
| Command | Description |
|---|---|
| `/buy <symbol> <usdt>` | Manual market buy |
| `/sell <symbol> <usdt\|all>` | Manual market sell |
| `/override <id> <BUY\|SELL\|HOLD>` | Force next AI decision (one-time) |
| `/cancelbuy <symbol>` | Cancel open buy orders |
| `/cancelsell <symbol>` | Cancel open sell orders |

### AI & Analysis
| Command | Description |
|---|---|
| `/analyze <symbol>` | On-demand AI_FULL analysis |
| `/news <symbol>` | Latest 10 headlines + sentiment score |
| `/indicators <symbol>` | Current RSI, EMA, MACD, BB values |

### Notifications & Settings
| Command | Description |
|---|---|
| `/notifications` | Toggle notification types |
| `/silence <minutes>` | Mute all alerts for N minutes |
| `/settings` | View/edit user-level defaults |
| `/help` | Show command list |

### Proactive Notifications (bot-initiated)
| Event | Example message |
|---|---|
| Trade executed | `BUY 0.001 BTC @ $65,420 · Strategy: AI_FULL · Confidence: 0.83` |
| Stop-loss hit | `STOP-LOSS: sold BTC @ $62,000 · Loss: -5.2%` |
| Take-profit hit | `TAKE-PROFIT: sold BTC @ $71,500 · Profit: +9.3%` |
| Strategy auto-paused | `Strategy #3 paused: Binance API key rejected` |
| AI holds | `HOLD — news risk: "SEC investigation" detected` |
| Balance low | `Warning: USDT balance below $10, strategy #2 may fail` |

---

## 9. Security

- Binance API keys encrypted at rest with AES-256-GCM; encryption key from environment variable
- Keys never logged or sent over Telegram
- Telegram `telegramId` is the primary user identifier — no passwords stored
- Binance API keys should be created with **Spot trading only** permission, no withdrawal permission
- All BullMQ jobs include `userId` — jobs can never act on another user's keys

---

## 10. External Dependencies

| Service | Plan | Purpose |
|---|---|---|
| Neon PostgreSQL | Free tier | Primary data store |
| Redis (Upstash or Railway) | Free tier | BullMQ queues, session cache, orderbook cache |
| Binance | Free | Spot trading API + WebSocket streams |
| CryptoPanic | Free tier | Crypto news feed |
| CoinDesk / CoinTelegraph RSS | Free | Additional news sources |
| Claude API | Pay-per-use | AI signal analysis |
| Telegram Bot API | Free | User interface |

---

## 11. Package Dependencies

```
# Core
nestjs-telegraf        # Telegram long polling
@binance/connector     # Binance REST + WebSocket
@anthropic-ai/sdk      # Claude API
bullmq                 # Job queues
ioredis                # Redis client
typeorm                # ORM
pg                     # PostgreSQL driver

# Indicators
technicalindicators    # RSI, EMA, MACD, Bollinger Bands

# Utils
rss-parser             # RSS news feeds
axios                  # HTTP client for CryptoPanic
class-validator        # DTO validation
class-transformer
@nestjs/config         # Environment config
```
