import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import type { Context, Scenes } from 'telegraf';
import { UsersService } from '../users/users.service';
import { BinanceKeyService } from '../users/binance-key.service';
import { HELP_TEXT, SETKEYS_SCENE_ID } from './telegram.constants';

type SceneCtx = Scenes.SceneContext;

@Update()
export class TelegramUpdate {
  constructor(
    private readonly users: UsersService,
    private readonly keys: BinanceKeyService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await this.users.findOrCreate(String(ctx.from!.id));
    await ctx.reply(
      'Welcome to the trading bot. Run /setkeys to connect your Binance account, then /status to check it.',
    );
  }

  @Command('setkeys')
  async onSetkeys(@Ctx() ctx: SceneCtx): Promise<void> {
    await ctx.scene.enter(SETKEYS_SCENE_ID);
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context): Promise<void> {
    const user = await this.users.findByChatId(String(ctx.from!.id));
    if (!user) {
      await ctx.reply('You are not registered yet. Send /start first.');
      return;
    }
    const configured = await this.keys.hasActiveKey(user.id);
    await ctx.reply(
      `API keys: ${configured ? 'configured ✅' : 'not set — run /setkeys'}\nStrategies: coming soon`,
    );
  }

  @Command('deletekeys')
  async onDeleteKeys(@Ctx() ctx: Context): Promise<void> {
    const user = await this.users.findByChatId(String(ctx.from!.id));
    if (!user) {
      await ctx.reply('You are not registered yet. Send /start first.');
      return;
    }
    await this.keys.deleteKeys(user.id);
    await ctx.reply('Your stored API keys have been removed.');
  }

  @Help()
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(HELP_TEXT);
  }

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply('Unrecognized message. Send /help to see what I can do.');
  }
}
