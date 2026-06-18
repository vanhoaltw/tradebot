// src/trading/trading.constants.ts

/** Spot testnet REST base URL — the ONLY base URL this slice can reach. */
export const TESTNET_BASE_URL = 'https://testnet.binance.vision';

/** Per-order cap (USDT). `/buy` rejects amounts above this. */
export const MAX_SINGLE_ORDER_USDT = 1000;

/** Protective OCO levels, as fractions of the average fill price. */
export const STOP_LOSS_PCT = 0.05; // stop 5% below entry
export const TAKE_PROFIT_PCT = 0.1; // take-profit 10% above entry

/** Stop-limit price sits just inside the stop trigger so the limit fills. */
export const STOP_LIMIT_OFFSET = 0.999;

export const NO_KEYS_REPLY =
  'You have not connected Binance keys yet — run /setkeys first.';
