import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Trade } from './trade.entity';
import { BinanceClientFactory } from './binance-client.factory';
import { BinanceService } from './binance.service';
import { TradesService } from './trades.service';
import { TradingService } from './trading.service';
import { TradingUpdate } from './trading.update';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([Trade])],
  providers: [
    BinanceClientFactory,
    BinanceService,
    TradesService,
    TradingService,
    TradingUpdate,
  ],
})
export class TradingModule {}
