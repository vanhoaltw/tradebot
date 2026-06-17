// src/trading/trading.update.spec.ts
import { TradingUpdate } from './trading.update';

const makeDeps = () => ({
  users: { findByChatId: jest.fn() },
  trading: { getBalances: jest.fn(), buy: jest.fn(), sell: jest.fn() },
});

const makeCtx = (text: string) => ({
  from: { id: 123 },
  message: { text },
  reply: jest.fn().mockResolvedValue(undefined),
});

describe('TradingUpdate', () => {
  let deps: ReturnType<typeof makeDeps>;
  let update: TradingUpdate;

  beforeEach(() => {
    deps = makeDeps();
    update = new TradingUpdate(deps.users as never, deps.trading as never);
    deps.users.findByChatId.mockResolvedValue({ id: 'u1' });
  });

  describe('/balance', () => {
    it('prompts /start when unregistered', async () => {
      deps.users.findByChatId.mockResolvedValue(null);
      const ctx = makeCtx('/balance');
      await update.onBalance(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/start/i);
      expect(deps.trading.getBalances).not.toHaveBeenCalled();
    });

    it('nudges to /setkeys when no keys', async () => {
      deps.trading.getBalances.mockResolvedValue({ kind: 'no_keys' });
      const ctx = makeCtx('/balance');
      await update.onBalance(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/setkeys/i);
    });

    it('lists non-zero balances', async () => {
      deps.trading.getBalances.mockResolvedValue({
        kind: 'ok',
        balances: [{ asset: 'BTC', free: 0.002 }, { asset: 'USDT', free: 100 }],
      });
      const ctx = makeCtx('/balance');
      await update.onBalance(ctx as never);
      const reply = ctx.reply.mock.calls[0][0];
      expect(reply).toMatch(/USDT/);
      expect(reply).toMatch(/BTC/);
    });
  });

  describe('/buy', () => {
    it('replies a usage hint on bad args', async () => {
      const ctx = makeCtx('/buy btc');
      await update.onBuy(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/Usage: \/buy/);
      expect(deps.trading.buy).not.toHaveBeenCalled();
    });

    it('reports a fill plus OCO placed', async () => {
      deps.trading.buy.mockResolvedValue({
        kind: 'filled', symbol: 'BTCUSDT', quantity: 0.001, avgPrice: 50000, oco: { placed: true },
      });
      const ctx = makeCtx('/buy btc 50');
      await update.onBuy(ctx as never);
      expect(deps.trading.buy).toHaveBeenCalledWith('u1', 'btc', 50);
      const reply = ctx.reply.mock.calls[0][0];
      expect(reply).toMatch(/BTCUSDT/);
      expect(reply).toMatch(/protected|OCO/i);
    });

    it('warns about an unprotected position when OCO failed', async () => {
      deps.trading.buy.mockResolvedValue({
        kind: 'filled', symbol: 'BTCUSDT', quantity: 0.001, avgPrice: 50000,
        oco: { placed: false, reason: 'rejected' },
      });
      const ctx = makeCtx('/buy btc 50');
      await update.onBuy(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/unprotected/i);
    });

    it('relays a rejection reason', async () => {
      deps.trading.buy.mockResolvedValue({ kind: 'rejected', reason: 'Insufficient USDT balance' });
      const ctx = makeCtx('/buy btc 50');
      await update.onBuy(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/Insufficient/);
    });
  });

  describe('/sell', () => {
    it('replies a usage hint on bad args', async () => {
      const ctx = makeCtx('/sell');
      await update.onSell(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/Usage: \/sell/);
    });

    it('reports a fill', async () => {
      deps.trading.sell.mockResolvedValue({ kind: 'filled', symbol: 'BTCUSDT', quantity: 0.005, avgPrice: 50000 });
      const ctx = makeCtx('/sell btc all');
      await update.onSell(ctx as never);
      expect(deps.trading.sell).toHaveBeenCalledWith('u1', 'btc', 'all');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/BTCUSDT/);
    });
  });
});
