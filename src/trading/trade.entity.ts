import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TradeSide {
  Buy = 'BUY',
  Sell = 'SELL',
}

export enum TradeStatus {
  Pending = 'PENDING',
  Filled = 'FILLED',
  Cancelled = 'CANCELLED',
  Failed = 'FAILED',
}

@Index('idx_trades_user_id', ['userId'])
@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** No FK yet — the strategies module does not exist. Always null for manual trades. */
  @Column({ name: 'strategy_id', type: 'uuid', nullable: true })
  strategyId!: string | null;

  @Column({ type: 'varchar' })
  symbol!: string;

  @Column({ type: 'enum', enum: TradeSide, enumName: 'trade_side_enum' })
  side!: TradeSide;

  /** numeric → string in JS. Null on a FAILED trade that never filled. */
  @Column({ type: 'numeric', nullable: true })
  quantity!: string | null;

  /** Fill price. Null on a FAILED trade that never filled. */
  @Column({ type: 'numeric', nullable: true })
  price!: string | null;

  @Column({ type: 'enum', enum: TradeStatus, enumName: 'trade_status_enum' })
  status!: TradeStatus;

  @Column({ name: 'binance_order_id', type: 'varchar', nullable: true })
  binanceOrderId!: string | null;

  @Column({ name: 'filled_at', type: 'timestamptz', nullable: true })
  filledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
