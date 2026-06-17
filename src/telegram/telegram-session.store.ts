import type { Redis } from 'ioredis';
import { SESSION_TTL_SECONDS } from './telegram.constants';

/**
 * Telegraf SessionStore backed by Redis. Keys are namespaced `user:{name}:state`
 * (the session key is the Telegram user id) and expire after SESSION_TTL_SECONDS.
 */
export class RedisSessionStore {
  constructor(private readonly redis: Redis) {}

  private key(name: string): string {
    return `user:${name}:state`;
  }

  async get(name: string): Promise<unknown> {
    const raw = await this.redis.get(this.key(name));
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  }

  async set(name: string, value: unknown): Promise<void> {
    await this.redis.set(this.key(name), JSON.stringify(value), 'EX', SESSION_TTL_SECONDS);
  }

  async delete(name: string): Promise<void> {
    await this.redis.del(this.key(name));
  }
}
