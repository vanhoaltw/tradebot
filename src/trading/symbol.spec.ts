import { normalizeSymbol } from './symbol';

describe('normalizeSymbol', () => {
  it('upper-cases and appends USDT to a bare base asset', () => {
    expect(normalizeSymbol('btc')).toBe('BTCUSDT');
  });

  it('leaves an already-quoted pair unchanged (case-normalised)', () => {
    expect(normalizeSymbol('ethusdt')).toBe('ETHUSDT');
    expect(normalizeSymbol('ETHUSDT')).toBe('ETHUSDT');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSymbol('  sol  ')).toBe('SOLUSDT');
  });

  it('throws on empty input', () => {
    expect(() => normalizeSymbol('   ')).toThrow(/symbol/i);
  });
});
