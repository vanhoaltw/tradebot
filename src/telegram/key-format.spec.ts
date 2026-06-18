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
