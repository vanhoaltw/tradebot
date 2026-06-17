const QUOTE_ASSET = 'USDT';

/** 'btc' → 'BTCUSDT'; an already-quoted pair is returned upper-cased. */
export function normalizeSymbol(input: string): string {
  const s = input.trim().toUpperCase();
  if (!s) {
    throw new Error('Symbol is required');
  }
  return s.endsWith(QUOTE_ASSET) ? s : `${s}${QUOTE_ASSET}`;
}
