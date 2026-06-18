/** Binance API keys and secrets are 64-character alphanumeric strings. */
const BINANCE_KEY_RE = /^[A-Za-z0-9]{64}$/;

export function isPlausibleBinanceKey(value: string): boolean {
  return BINANCE_KEY_RE.test(value);
}
