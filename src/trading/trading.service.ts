// src/trading/trading.service.ts
import { Injectable } from '@nestjs/common';
import { BinanceKeyService } from '../users/binance-key.service';
import { BinanceClientFactory } from './binance-client.factory';
import { BinanceService, Balance } from './binance.service';
import { TradesService } from './trades.service';
import { TradeSide, TradeStatus } from './trade.entity';
import { normalizeSymbol } from './symbol';
import { roundToStep, roundToTick } from './precision';
import {
  MAX_SINGLE_ORDER_USDT,
  STOP_LOSS_PCT,
  TAKE_PROFIT_PCT,
  STOP_LIMIT_OFFSET,
} from './trading.constants';

export type BalancesResult =
  | { kind: 'no_keys' }
  | { kind: 'ok'; balances: Balance[] };

export type BuyResult =
  | { kind: 'no_keys' }
  | { kind: 'rejected'; reason: string }
  | {
      kind: 'filled';
      symbol: string;
      quantity: number;
      avgPrice: number;
      oco: { placed: true } | { placed: false; reason: string };
    };

export type SellResult =
  | { kind: 'no_keys' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'filled'; symbol: string; quantity: number; avgPrice: number };

/** Extract a human-readable reason from a Binance/axios-style rejection. */
function binanceReason(err: unknown): string {
  const maybe = err as { response?: { data?: { msg?: string } }; message?: string };
  return maybe?.response?.data?.msg ?? maybe?.message ?? 'Binance rejected the order.';
}

@Injectable()
export class TradingService {
  constructor(
    private readonly clientFactory: BinanceClientFactory,
    private readonly binance: BinanceService,
    private readonly keys: BinanceKeyService,
    private readonly trades: TradesService,
  ) {}

  async getBalances(userId: string): Promise<BalancesResult> {
    const key = await this.keys.getActiveKey(userId);
    if (!key) return { kind: 'no_keys' };
    const client = this.clientFactory.create(key.apiKey, key.secret);
    const balances = await this.binance.getBalances(client);
    return { kind: 'ok', balances };
  }

  async buy(userId: string, rawSymbol: string, usdt: number): Promise<BuyResult> {
    if (usdt > MAX_SINGLE_ORDER_USDT) {
      return {
        kind: 'rejected',
        reason: `Amount exceeds the per-order cap of ${MAX_SINGLE_ORDER_USDT} USDT.`,
      };
    }
    const key = await this.keys.getActiveKey(userId);
    if (!key) return { kind: 'no_keys' };
    const client = this.clientFactory.create(key.apiKey, key.secret);
    const symbol = normalizeSymbol(rawSymbol);
    const filters = await this.binance.getSymbolFilters(client, symbol);

    const balances = await this.binance.getBalances(client);
    const freeUsdt = balances.find((b) => b.asset === 'USDT')?.free ?? 0;
    if (usdt > freeUsdt) {
      return { kind: 'rejected', reason: `Insufficient USDT balance — you have ${freeUsdt} USDT.` };
    }

    const price = await this.binance.getPrice(client, symbol);
    const quantity = roundToStep(usdt / price, filters.stepSize);
    if (quantity < filters.minQty) {
      return { kind: 'rejected', reason: `Quantity ${quantity} is below the minimum ${filters.minQty} for ${symbol}.` };
    }
    if (quantity * price < filters.minNotional) {
      return { kind: 'rejected', reason: `Order value is below the ${filters.minNotional} USDT minimum notional for ${symbol}.` };
    }

    let fill;
    try {
      fill = await this.binance.marketBuy(client, symbol, quantity);
    } catch (err) {
      await this.trades.record({ userId, symbol, side: TradeSide.Buy, status: TradeStatus.Failed });
      return { kind: 'rejected', reason: binanceReason(err) };
    }

    await this.trades.record({
      userId,
      symbol,
      side: TradeSide.Buy,
      status: TradeStatus.Filled,
      quantity: fill.executedQty,
      price: fill.avgPrice,
      binanceOrderId: String(fill.orderId),
      filledAt: new Date(),
    });

    const takeProfitPrice = roundToTick(fill.avgPrice * (1 + TAKE_PROFIT_PCT), filters.tickSize);
    const stopPrice = roundToTick(fill.avgPrice * (1 - STOP_LOSS_PCT), filters.tickSize);
    const stopLimitPrice = roundToTick(stopPrice * STOP_LIMIT_OFFSET, filters.tickSize);

    let oco: { placed: true } | { placed: false; reason: string };
    try {
      await this.binance.placeOcoSell(client, symbol, fill.executedQty, takeProfitPrice, stopPrice, stopLimitPrice);
      oco = { placed: true };
    } catch (err) {
      oco = { placed: false, reason: binanceReason(err) };
    }

    return { kind: 'filled', symbol, quantity: fill.executedQty, avgPrice: fill.avgPrice, oco };
  }

  async sell(userId: string, rawSymbol: string, amount: number | 'all'): Promise<SellResult> {
    const key = await this.keys.getActiveKey(userId);
    if (!key) return { kind: 'no_keys' };
    const client = this.clientFactory.create(key.apiKey, key.secret);
    const symbol = normalizeSymbol(rawSymbol);

    // Cancel any resting OCO for this symbol before selling (parent spec §6).
    await this.binance.cancelOpenOrders(client, symbol);

    const filters = await this.binance.getSymbolFilters(client, symbol);
    const price = await this.binance.getPrice(client, symbol);

    let quantity: number;
    if (amount === 'all') {
      const base = symbol.replace(/USDT$/, '');
      const balances = await this.binance.getBalances(client);
      const freeBase = balances.find((b) => b.asset === base)?.free ?? 0;
      quantity = roundToStep(freeBase, filters.stepSize);
    } else {
      quantity = roundToStep(amount / price, filters.stepSize);
    }

    if (quantity < filters.minQty) {
      return { kind: 'rejected', reason: `Quantity ${quantity} is below the minimum ${filters.minQty} for ${symbol}.` };
    }
    if (quantity * price < filters.minNotional) {
      return { kind: 'rejected', reason: `Order value is below the ${filters.minNotional} USDT minimum notional for ${symbol}.` };
    }

    let fill;
    try {
      fill = await this.binance.marketSell(client, symbol, quantity);
    } catch (err) {
      await this.trades.record({ userId, symbol, side: TradeSide.Sell, status: TradeStatus.Failed });
      return { kind: 'rejected', reason: binanceReason(err) };
    }

    await this.trades.record({
      userId,
      symbol,
      side: TradeSide.Sell,
      status: TradeStatus.Filled,
      quantity: fill.executedQty,
      price: fill.avgPrice,
      binanceOrderId: String(fill.orderId),
      filledAt: new Date(),
    });

    return { kind: 'filled', symbol, quantity: fill.executedQty, avgPrice: fill.avgPrice };
  }
}
