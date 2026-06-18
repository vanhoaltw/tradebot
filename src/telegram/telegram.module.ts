import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectBot, TelegrafModule } from 'nestjs-telegraf';
import { session, Telegraf } from 'telegraf';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.constants';
import { UsersModule } from '../users/users.module';
import { RedisSessionStore } from './telegram-session.store';
import { SetkeysWizard } from './scenes/setkeys.wizard';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [
    UsersModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN', { infer: true });
        if (!token) {
          throw new Error(
            'TELEGRAM_BOT_TOKEN is required to start the Telegram bot',
          );
        }
        const store = new RedisSessionStore(redis);
        return {
          token,
          middlewares: [
            session({
              store,
              getSessionKey: (ctx) => {
                console.log({ ctx });
                return ctx.from ? String(ctx.from.id) : undefined;
              },
            }),
          ],
        };
      },
    }),
  ],
  providers: [TelegramUpdate, SetkeysWizard],
})
export class TelegramModule {
  constructor(@InjectBot() private readonly bot: Telegraf) {
    // Global safety net: a throwing handler must never crash the bot process.
    this.bot.catch((err, ctx) => {
      console.error('[telegram] handler error', err);
      // Best-effort user feedback; never throw from the catch handler itself.
      void ctx
        .reply('Something went wrong. Please try again.')
        .catch(() => undefined);
    });
  }
}
