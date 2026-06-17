import { SESSION_TTL_SECONDS } from './telegram.constants';
import { RedisSessionStore } from './telegram-session.store';

const mockRedis = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

describe('RedisSessionStore', () => {
  let redis: ReturnType<typeof mockRedis>;
  let store: RedisSessionStore;

  beforeEach(() => {
    redis = mockRedis();
    store = new RedisSessionStore(redis as never);
  });

  describe('get', () => {
    it('returns the parsed value under the namespaced key', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ step: 2 }));

      await expect(store.get('123')).resolves.toEqual({ step: 2 });
      expect(redis.get).toHaveBeenCalledWith('user:123:state');
    });

    it('returns undefined when the key is absent', async () => {
      redis.get.mockResolvedValue(null);
      await expect(store.get('123')).resolves.toBeUndefined();
    });
  });

  describe('set', () => {
    it('writes JSON with a TTL under the namespaced key', async () => {
      redis.set.mockResolvedValue('OK');

      await store.set('123', { step: 1 });

      expect(redis.set).toHaveBeenCalledWith(
        'user:123:state',
        JSON.stringify({ step: 1 }),
        'EX',
        SESSION_TTL_SECONDS,
      );
    });
  });

  describe('delete', () => {
    it('deletes the namespaced key', async () => {
      redis.del.mockResolvedValue(1);

      await store.delete('123');

      expect(redis.del).toHaveBeenCalledWith('user:123:state');
    });
  });
});
