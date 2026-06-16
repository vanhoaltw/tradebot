import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinanceKey } from './binance-key.entity';
import { BinanceKeyService } from './binance-key.service';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, BinanceKey])],
  providers: [UsersService, BinanceKeyService],
  exports: [UsersService, BinanceKeyService],
})
export class UsersModule {}
