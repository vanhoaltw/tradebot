export interface BuyArgs {
  symbol: string;
  usdt: number;
}

export interface SellArgs {
  symbol: string;
  amount: number | 'all';
}

/** Split a command message into its whitespace-separated tokens after the command word. */
function tokens(text: string): { symbol?: string; amountRaw?: string } {
  const parts = text.trim().split(/\s+/);
  return { symbol: parts[1], amountRaw: parts[2] };
}

export function parseBuyArgs(text: string): BuyArgs {
  const { symbol, amountRaw } = tokens(text);
  if (!symbol || !amountRaw) {
    throw new Error('Usage: /buy <symbol> <usdt>');
  }
  const usdt = Number(amountRaw);
  if (!Number.isFinite(usdt) || usdt <= 0) {
    throw new Error('Amount must be a positive number. Usage: /buy <symbol> <usdt>');
  }
  return { symbol, usdt };
}

export function parseSellArgs(text: string): SellArgs {
  const { symbol, amountRaw } = tokens(text);
  if (!symbol || !amountRaw) {
    throw new Error('Usage: /sell <symbol> <usdt|all>');
  }
  if (amountRaw.toLowerCase() === 'all') {
    return { symbol, amount: 'all' };
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be a positive number or "all". Usage: /sell <symbol> <usdt|all>');
  }
  return { symbol, amount };
}
