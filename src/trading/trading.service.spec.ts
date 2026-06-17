// src/trading/trading.service.spec.ts
import { TradingService } from './trading.service';
import { TradeSide, TradeStatus } from './trade.entity';
import { MAX_SINGLE_ORDER_USDT } from './trading.constants';

const makeDeps = () => ({
  clientFactory: { create: jest.fn(() => ({})) },
  binance: {
    getBalances: jest.fn(),
    getSymbolFilters: jest.fn(),
    getPrice: jest.fn(),
    marketBuy: jest.fn(),
    marketSell: jest.fn(),
    placeOcoSell: jest.fn(),
    cancelOpenOrders: jest.fn(),
  },
  keys: { getActiveKey: jest.fn() },
  trades: { record: jest.fn().mockResolvedValue({ id: 't1' }) },
});

const FILTERS = { stepSize: 0.00001, minQty: 0.0001, tickSize: 0.01, minNotional: 10 };

describe('TradingService', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: TradingService;

  beforeEach(() => {
    deps = makeDeps();
    service = new TradingService(
      deps.clientFactory as never,
      deps.binance as never,
      deps.keys as never,
      deps.trades as never,
    );
  });

  describe('getBalances', () => {
    it('returns no_keys when the user has no active key', async () => {
      deps.keys.getActiveKey.mockResolvedValue(null);
      await expect(service.getBalances('u1')).resolves.toEqual({ kind: 'no_keys' });
    });

    it('returns balances for a keyed user', async () => {
      deps.keys.getActiveKey.mockResolvedValue({ apiKey: 'k', secret: 's' });
      deps.binance.getBalances.mockResolvedValue([{ asset: 'USDT', free: 100 }]);
      await expect(service.getBalances('u1')).resolves.toEqual({
        kind: 'ok',
        balances: [{ asset: 'USDT', free: 100 }],
      });
    });
  });

  describe('buy', () => {
    beforeEach(() => {
      deps.keys.getActiveKey.mockResolvedValue({ apiKey: 'k', secret: 's' });
      deps.binance.getSymbolFilters.mockResolvedValue(FILTERS);
      deps.binance.getBalances.mockResolvedValue([{ asset: 'USDT', free: 1000 }]);
      deps.binance.getPrice.mockResolvedValue(50000);
    });

    it('rejects amounts over the per-order cap without touching the SDK', async () => {
      const result = await service.buy('u1', 'btc', MAX_SINGLE_ORDER_USDT + 1);
      expect(result).toEqual({ kind: 'rejected', reason: expect.stringMatching(/cap/i) });
      expect(deps.keys.getActiveKey).not.toHaveBeenCalled();
    });

    it('returns no_keys when the user has no active key', async () => {
      deps.keys.getActiveKey.mockResolvedValue(null);
      await expect(service.buy('u1', 'btc', 50)).resolves.toEqual({ kind: 'no_keys' });
    });

    it('rejects when the amount exceeds free USDT', async () => {
      deps.binance.getBalances.mockResolvedValue([{ asset: 'USDT', free: 20 }]);
      const result = await service.buy('u1', 'btc', 50);
      expect(result).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/balance/i) });
      expect(deps.binance.marketBuy).not.toHaveBeenCalled();
    });

    it('rejects when the rounded notional is below minNotional', async () => {
      // 5 USDT / 50000 = 0.0001 qty → notional 5 < minNotional 10
      const result = await service.buy('u1', 'btc', 5);
      expect(result).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/notional/i) });
      expect(deps.binance.marketBuy).not.toHaveBeenCalled();
    });

    it('buys by computed quantity, persists FILLED, and places a protective OCO', async () => {
      deps.binance.marketBuy.mockResolvedValue({ orderId: 42, executedQty: 0.001, avgPrice: 50000 });
      deps.binance.placeOcoSell.mockResolvedValue({ orderListId: 99 });

      const result = await service.buy('u1', 'btc', 50);

      // qty = 50 / 50000 = 0.001, floored to stepSize
      expect(deps.binance.marketBuy).toHaveBeenCalledWith(expect.anything(), 'BTCUSDT', 0.001);
      expect(deps.trades.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          symbol: 'BTCUSDT',
          side: TradeSide.Buy,
          status: TradeStatus.Filled,
          quantity: 0.001,
          price: 50000,
          binanceOrderId: '42',
        }),
      );
      // OCO: TP = 50000*1.10 = 55000, stop = 50000*0.95 = 47500, stopLimit = 47500*0.999 = 47452.5
      expect(deps.binance.placeOcoSell).toHaveBeenCalledWith(
        expect.anything(), 'BTCUSDT', 0.001, 55000, 47500, 47452.5,
      );
      expect(result).toEqual({
        kind: 'filled',
        symbol: 'BTCUSDT',
        quantity: 0.001,
        avgPrice: 50000,
        oco: { placed: true },
      });
    });

    it('reports an unprotected position when the OCO is rejected (buy still succeeds)', async () => {
      deps.binance.marketBuy.mockResolvedValue({ orderId: 42, executedQty: 0.001, avgPrice: 50000 });
      deps.binance.placeOcoSell.mockRejectedValue(new Error('OCO rejected'));

      const result = await service.buy('u1', 'btc', 50);

      expect(deps.trades.record).toHaveBeenCalledWith(
        expect.objectContaining({ status: TradeStatus.Filled }),
      );
      expect(result).toMatchObject({
        kind: 'filled',
        oco: { placed: false, reason: expect.stringMatching(/OCO rejected/) },
      });
    });

    it('persists a FAILED trade and rejects when the market buy is rejected', async () => {
      deps.binance.marketBuy.mockRejectedValue({ response: { data: { msg: 'Filter failure: LOT_SIZE' } } });

      const result = await service.buy('u1', 'btc', 50);

      expect(deps.trades.record).toHaveBeenCalledWith(
        expect.objectContaining({ status: TradeStatus.Failed, symbol: 'BTCUSDT', side: TradeSide.Buy }),
      );
      expect(result).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/LOT_SIZE/) });
    });
  });

  describe('sell', () => {
    beforeEach(() => {
      deps.keys.getActiveKey.mockResolvedValue({ apiKey: 'k', secret: 's' });
      deps.binance.getSymbolFilters.mockResolvedValue(FILTERS);
      deps.binance.getPrice.mockResolvedValue(50000);
      deps.binance.cancelOpenOrders.mockResolvedValue(1);
    });

    it('returns no_keys when the user has no active key', async () => {
      deps.keys.getActiveKey.mockResolvedValue(null);
      await expect(service.sell('u1', 'btc', 'all')).resolves.toEqual({ kind: 'no_keys' });
    });

    it('cancels resting orders, sells the full base balance for "all", and persists FILLED', async () => {
      deps.binance.getBalances.mockResolvedValue([{ asset: 'BTC', free: 0.005 }]);
      deps.binance.marketSell.mockResolvedValue({ orderId: 7, executedQty: 0.005, avgPrice: 50000 });

      const result = await service.sell('u1', 'btc', 'all');

      expect(deps.binance.cancelOpenOrders).toHaveBeenCalledWith(expect.anything(), 'BTCUSDT');
      expect(deps.binance.marketSell).toHaveBeenCalledWith(expect.anything(), 'BTCUSDT', 0.005);
      expect(deps.trades.record).toHaveBeenCalledWith(
        expect.objectContaining({ side: TradeSide.Sell, status: TradeStatus.Filled, quantity: 0.005 }),
      );
      expect(result).toEqual({ kind: 'filled', symbol: 'BTCUSDT', quantity: 0.005, avgPrice: 50000 });
    });

    it('sells a usdt-denominated amount by computed quantity', async () => {
      deps.binance.marketSell.mockResolvedValue({ orderId: 8, executedQty: 0.0005, avgPrice: 50000 });
      const result = await service.sell('u1', 'btc', 25); // 25/50000 = 0.0005
      expect(deps.binance.marketSell).toHaveBeenCalledWith(expect.anything(), 'BTCUSDT', 0.0005);
      expect(result).toMatchObject({ kind: 'filled', quantity: 0.0005 });
    });

    it('persists a FAILED trade when the market sell is rejected', async () => {
      deps.binance.getBalances.mockResolvedValue([{ asset: 'BTC', free: 0.005 }]);
      deps.binance.marketSell.mockRejectedValue({ response: { data: { msg: 'Account has insufficient balance' } } });

      const result = await service.sell('u1', 'btc', 'all');

      expect(deps.trades.record).toHaveBeenCalledWith(
        expect.objectContaining({ status: TradeStatus.Failed, side: TradeSide.Sell }),
      );
      expect(result).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/insufficient/i) });
    });
  });
});
