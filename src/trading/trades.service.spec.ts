import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Trade, TradeSide, TradeStatus } from './trade.entity';
import { TradesService } from './trades.service';

const mockRepo = () => ({
  create: jest.fn((x) => x),
  save: jest.fn((x) => Promise.resolve({ id: 't1', ...x })),
});

describe('TradesService', () => {
  let service: TradesService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TradesService,
        { provide: getRepositoryToken(Trade), useFactory: mockRepo },
      ],
    }).compile();
    service = module.get(TradesService);
    repo = module.get(getRepositoryToken(Trade));
  });

  it('writes a FILLED trade with numeric fields serialised to strings', async () => {
    await service.record({
      userId: 'u1',
      symbol: 'BTCUSDT',
      side: TradeSide.Buy,
      status: TradeStatus.Filled,
      quantity: 0.001,
      price: 65000,
      binanceOrderId: '12345',
      filledAt: new Date('2026-06-17T00:00:00Z'),
    });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        strategyId: null,
        symbol: 'BTCUSDT',
        side: 'BUY',
        status: 'FILLED',
        quantity: '0.001',
        price: '65000',
        binanceOrderId: '12345',
      }),
    );
  });

  it('writes a FAILED trade with null quantity/price/filledAt', async () => {
    await service.record({
      userId: 'u1',
      symbol: 'BTCUSDT',
      side: TradeSide.Buy,
      status: TradeStatus.Failed,
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        quantity: null,
        price: null,
        binanceOrderId: null,
        filledAt: null,
      }),
    );
  });
});
