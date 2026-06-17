import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeSide, TradeStatus } from './trade.entity';

export interface RecordTradeInput {
  userId: string;
  symbol: string;
  side: TradeSide;
  status: TradeStatus;
  quantity?: number | null;
  price?: number | null;
  binanceOrderId?: string | null;
  filledAt?: Date | null;
  strategyId?: string | null;
}

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Trade)
    private readonly repo: Repository<Trade>,
  ) {}

  /** Persist a Trade row. Numeric fields are stored as strings (Postgres numeric). */
  async record(input: RecordTradeInput): Promise<Trade> {
    return this.repo.save(
      this.repo.create({
        userId: input.userId,
        strategyId: input.strategyId ?? null,
        symbol: input.symbol,
        side: input.side,
        status: input.status,
        quantity: input.quantity != null ? String(input.quantity) : null,
        price: input.price != null ? String(input.price) : null,
        binanceOrderId: input.binanceOrderId ?? null,
        filledAt: input.filledAt ?? null,
      }),
    );
  }
}
