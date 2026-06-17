// src/trading/binance.service.spec.ts
import { BinanceService } from './binance.service';
import type { SpotClient } from './binance.service';

const makeClient = (): jest.Mocked<SpotClient> => ({
  account: jest.fn(),
  exchangeInfo: jest.fn(),
  tickerPrice: jest.fn(),
  newOrder: jest.fn(),
  newOCOOrder: jest.fn(),
  cancelOpenOrders: jest.fn(),
});

describe('BinanceService', () => {
  let service: BinanceService;
  let client: jest.Mocked<SpotClient>;

  beforeEach(() => {
    service = new BinanceService();
    client = makeClient();
  });

  it('getBalances returns only non-zero free balances as numbers', async () => {
    client.account.mockResolvedValue({
      data: {
        balances: [
          { asset: 'USDT', free: '100.5', locked: '0' },
          { asset: 'BTC', free: '0.002', locked: '0' },
          { asset: 'ETH', free: '0', locked: '0' },
        ],
      },
    });

    await expect(service.getBalances(client)).resolves.toEqual([
      { asset: 'USDT', free: 100.5 },
      { asset: 'BTC', free: 0.002 },
    ]);
  });

  it('getSymbolFilters extracts step/tick/minQty/minNotional', async () => {
    client.exchangeInfo.mockResolvedValue({
      data: {
        symbols: [
          {
            filters: [
              { filterType: 'LOT_SIZE', stepSize: '0.00001', minQty: '0.0001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.01' },
              { filterType: 'NOTIONAL', minNotional: '10' },
            ],
          },
        ],
      },
    });

    await expect(service.getSymbolFilters(client, 'BTCUSDT')).resolves.toEqual({
      stepSize: 0.00001,
      minQty: 0.0001,
      tickSize: 0.01,
      minNotional: 10,
    });
    expect(client.exchangeInfo).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
  });

  it('getSymbolFilters throws when a required filter is missing', async () => {
    client.exchangeInfo.mockResolvedValue({
      data: {
        symbols: [
          {
            filters: [
              { filterType: 'LOT_SIZE', stepSize: '0.00001', minQty: '0.0001' },
              // PRICE_FILTER and NOTIONAL intentionally absent
            ],
          },
        ],
      },
    });

    await expect(service.getSymbolFilters(client, 'BTCUSDT')).rejects.toThrow(
      /Missing required filters/,
    );
  });

  it('getSymbolFilters throws when a filter field yields NaN (e.g. stepSize is absent)', async () => {
    client.exchangeInfo.mockResolvedValue({
      data: {
        symbols: [
          {
            filters: [
              // LOT_SIZE present but stepSize is undefined (absent key)
              { filterType: 'LOT_SIZE', minQty: '0.0001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.01' },
              { filterType: 'NOTIONAL', minNotional: '10' },
            ],
          },
        ],
      },
    });

    await expect(service.getSymbolFilters(client, 'BTCUSDT')).rejects.toThrow(
      /Invalid filter values for BTCUSDT/,
    );
  });

  it('getPrice returns the ticker price as a number', async () => {
    client.tickerPrice.mockResolvedValue({ data: { symbol: 'BTCUSDT', price: '65000.5' } });
    await expect(service.getPrice(client, 'BTCUSDT')).resolves.toBe(65000.5);
  });

  it('marketBuy submits a MARKET BUY by quantity and computes the avg fill price', async () => {
    client.newOrder.mockResolvedValue({
      data: {
        orderId: 42,
        executedQty: '0.002',
        fills: [
          { price: '65000', qty: '0.001' },
          { price: '65100', qty: '0.001' },
        ],
      },
    });

    const result = await service.marketBuy(client, 'BTCUSDT', 0.002);

    expect(client.newOrder).toHaveBeenCalledWith('BTCUSDT', 'BUY', 'MARKET', {
      quantity: 0.002,
    });
    expect(result).toEqual({ orderId: 42, executedQty: 0.002, avgPrice: 65050 });
  });

  it('marketSell submits a MARKET SELL by quantity', async () => {
    client.newOrder.mockResolvedValue({
      data: { orderId: 7, executedQty: '0.5', fills: [{ price: '2000', qty: '0.5' }] },
    });

    const result = await service.marketSell(client, 'ETHUSDT', 0.5);

    expect(client.newOrder).toHaveBeenCalledWith('ETHUSDT', 'SELL', 'MARKET', {
      quantity: 0.5,
    });
    expect(result).toEqual({ orderId: 7, executedQty: 0.5, avgPrice: 2000 });
  });

  it('placeOcoSell submits an OCO SELL with stop-limit options and returns orderListId', async () => {
    client.newOCOOrder.mockResolvedValue({ data: { orderListId: 99 } });

    const result = await service.placeOcoSell(client, 'BTCUSDT', 0.002, 71500, 61750, 61688.25);

    expect(client.newOCOOrder).toHaveBeenCalledWith(
      'BTCUSDT',
      'SELL',
      0.002,
      71500,
      61750,
      { stopLimitPrice: 61688.25, stopLimitTimeInForce: 'GTC' },
    );
    expect(result).toEqual({ orderListId: 99 });
  });

  it('cancelOpenOrders returns the number of cancelled orders', async () => {
    client.cancelOpenOrders.mockResolvedValue({ data: [{ orderId: 1 }, { orderId: 2 }] });
    await expect(service.cancelOpenOrders(client, 'BTCUSDT')).resolves.toBe(2);
    expect(client.cancelOpenOrders).toHaveBeenCalledWith('BTCUSDT');
  });
});
