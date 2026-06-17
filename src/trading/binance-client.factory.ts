import { Injectable } from '@nestjs/common';
import { Spot } from '@binance/connector';
import type { SpotClient } from './binance.service';
import { TESTNET_BASE_URL } from './trading.constants';

@Injectable()
export class BinanceClientFactory {
  /** Build a per-user Spot client. The base URL is hardcoded to testnet — live trading is structurally impossible this slice. */
  create(apiKey: string, secret: string): SpotClient {
    return new Spot(apiKey, secret, {
      baseURL: TESTNET_BASE_URL,
    }) as unknown as SpotClient;
  }
}
