import { parseBuyArgs, parseSellArgs } from './trade-args';

describe('parseBuyArgs', () => {
  it('parses symbol and usdt amount', () => {
    expect(parseBuyArgs('/buy btc 50')).toEqual({ symbol: 'btc', usdt: 50 });
  });

  it('tolerates extra whitespace', () => {
    expect(parseBuyArgs('/buy   eth   25.5 ')).toEqual({ symbol: 'eth', usdt: 25.5 });
  });

  it('throws usage on missing amount', () => {
    expect(() => parseBuyArgs('/buy btc')).toThrow(/Usage: \/buy/);
  });

  it('throws on non-numeric amount', () => {
    expect(() => parseBuyArgs('/buy btc abc')).toThrow(/positive number/);
  });

  it('throws on zero or negative amount', () => {
    expect(() => parseBuyArgs('/buy btc 0')).toThrow(/positive number/);
    expect(() => parseBuyArgs('/buy btc -5')).toThrow(/positive number/);
  });
});

describe('parseSellArgs', () => {
  it('parses a usdt amount', () => {
    expect(parseSellArgs('/sell btc 25')).toEqual({ symbol: 'btc', amount: 25 });
  });

  it('parses the "all" keyword (case-insensitive)', () => {
    expect(parseSellArgs('/sell btc ALL')).toEqual({ symbol: 'btc', amount: 'all' });
  });

  it('throws usage on missing amount', () => {
    expect(() => parseSellArgs('/sell btc')).toThrow(/Usage: \/sell/);
  });

  it('throws on an invalid amount', () => {
    expect(() => parseSellArgs('/sell btc nope')).toThrow(/positive number or "all"/);
  });
});
