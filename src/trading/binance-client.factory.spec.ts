const spotCtor = jest.fn();
jest.mock('@binance/connector', () => ({
  Spot: class {
    constructor(...args: unknown[]) {
      spotCtor(...args);
    }
  },
}));

import { BinanceClientFactory } from './binance-client.factory';
import { TESTNET_BASE_URL } from './trading.constants';

describe('BinanceClientFactory', () => {
  beforeEach(() => spotCtor.mockClear());

  it('builds a Spot client with the testnet base URL and the given keys', () => {
    const factory = new BinanceClientFactory();
    factory.create('api-key', 'secret');

    expect(spotCtor).toHaveBeenCalledWith('api-key', 'secret', {
      baseURL: TESTNET_BASE_URL,
    });
  });
});
