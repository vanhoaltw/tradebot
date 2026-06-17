// src/trading/binance.service.ts
import { Injectable } from '@nestjs/common';

interface RawFilter {
  filterType: string;
  stepSize?: string;
  minQty?: string;
  tickSize?: string;
  minNotional?: string;
}

interface RawFill {
  price: string;
  qty: string;
}

/** The subset of the @binance/connector Spot client this app uses. The only typed SDK surface. */
export interface SpotClient {
  account(): Promise<{
    data: { balances: { asset: string; free: string; locked: string }[] };
  }>;
  exchangeInfo(options: { symbol: string }): Promise<{
    data: { symbols: { filters: RawFilter[] }[] };
  }>;
  tickerPrice(
    symbol: string,
  ): Promise<{ data: { symbol: string; price: string } }>;
  newOrder(
    symbol: string,
    side: string,
    type: string,
    options: Record<string, unknown>,
  ): Promise<{
    data: { orderId: number; executedQty: string; fills: RawFill[] };
  }>;
  newOCOOrder(
    symbol: string,
    side: string,
    quantity: number,
    price: number,
    stopPrice: number,
    options: Record<string, unknown>,
  ): Promise<{ data: { orderListId: number } }>;
  cancelOpenOrders(symbol: string): Promise<{ data: unknown[] }>;
}

export interface Balance {
  asset: string;
  free: number;
}

export interface SymbolFilters {
  stepSize: number;
  minQty: number;
  tickSize: number;
  minNotional: number;
}

export interface OrderFill {
  orderId: number;
  executedQty: number;
  avgPrice: number;
}

/** Weighted-average fill price across the order's fills. */
function avgFillPrice(fills: RawFill[]): number {
  const totalQty = fills.reduce((sum, f) => sum + Number(f.qty), 0);
  if (totalQty === 0) return 0;
  const totalQuote = fills.reduce(
    (sum, f) => sum + Number(f.price) * Number(f.qty),
    0,
  );
  // Round to 8 decimal places to avoid floating-point drift (Binance max precision)
  return Math.round((totalQuote / totalQty) * 1e8) / 1e8;
}

@Injectable()
export class BinanceService {
  async getBalances(client: SpotClient): Promise<Balance[]> {
    const { data } = await client.account();
    return data.balances
      .map((b) => ({ asset: b.asset, free: Number(b.free) }))
      .filter((b) => b.free > 0);
  }

  async getSymbolFilters(
    client: SpotClient,
    symbol: string,
  ): Promise<SymbolFilters> {
    const { data } = await client.exchangeInfo({ symbol });
    const filters = data.symbols[0].filters;
    const lot = filters.find((f) => f.filterType === 'LOT_SIZE');
    const price = filters.find((f) => f.filterType === 'PRICE_FILTER');
    const notional = filters.find(
      (f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL',
    );
    return {
      stepSize: Number(lot?.stepSize),
      minQty: Number(lot?.minQty),
      tickSize: Number(price?.tickSize),
      minNotional: Number(notional?.minNotional),
    };
  }

  async getPrice(client: SpotClient, symbol: string): Promise<number> {
    const { data } = await client.tickerPrice(symbol);
    return Number(data.price);
  }

  async marketBuy(
    client: SpotClient,
    symbol: string,
    quantity: number,
  ): Promise<OrderFill> {
    const { data } = await client.newOrder(symbol, 'BUY', 'MARKET', { quantity });
    return {
      orderId: data.orderId,
      executedQty: Number(data.executedQty),
      avgPrice: avgFillPrice(data.fills),
    };
  }

  async marketSell(
    client: SpotClient,
    symbol: string,
    quantity: number,
  ): Promise<OrderFill> {
    const { data } = await client.newOrder(symbol, 'SELL', 'MARKET', { quantity });
    return {
      orderId: data.orderId,
      executedQty: Number(data.executedQty),
      avgPrice: avgFillPrice(data.fills),
    };
  }

  async placeOcoSell(
    client: SpotClient,
    symbol: string,
    quantity: number,
    takeProfitPrice: number,
    stopPrice: number,
    stopLimitPrice: number,
  ): Promise<{ orderListId: number }> {
    const { data } = await client.newOCOOrder(
      symbol,
      'SELL',
      quantity,
      takeProfitPrice,
      stopPrice,
      { stopLimitPrice, stopLimitTimeInForce: 'GTC' },
    );
    return { orderListId: data.orderListId };
  }

  async cancelOpenOrders(client: SpotClient, symbol: string): Promise<number> {
    const { data } = await client.cancelOpenOrders(symbol);
    return data.length;
  }
}
