import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import type { Context, Scenes } from 'telegraf';
import { UsersService } from '../users/users.service';
import { BinanceKeyService } from '../users/binance-key.service';
import { User } from '../users/user.entity';
import {
  HELP_TEXT,
  NOT_REGISTERED_REPLY,
  SETKEYS_SCENE_ID,
} from './telegram.constants';

type SceneCtx = Scenes.SceneContext;

@Update()
export class TelegramUpdate {
  constructor(
    private readonly users: UsersService,
    private readonly keys: BinanceKeyService,
  ) {
    console.log('inoi ip[date');
  }

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await this.users.findOrCreate(this.chatId(ctx));
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
    const user = await this.requireUser(ctx);
    if (!user) return;
    const configured = await this.keys.hasActiveKey(user.id);
    await ctx.reply(
      `API keys: ${configured ? 'configured ✅' : 'not set — run /setkeys'}\nStrategies: coming soon`,
    );
  }

  @Command('deletekeys')
  async onDeleteKeys(@Ctx() ctx: Context): Promise<void> {
    const user = await this.requireUser(ctx);
    if (!user) return;
    const removed = await this.keys.deleteKeys(user.id);
    await ctx.reply(
      removed
        ? 'Your stored API keys have been removed.'
        : 'You have no stored API keys to remove.',
    );
  }

  @Help()
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(HELP_TEXT);
  }

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply('Unrecognized message. Send /help to see what I can do.');
  }

  private chatId(ctx: Context): string {
    return String(ctx.from!.id);
  }

  /** Resolve the registered user, or reply prompting /start and return null. */
  private async requireUser(ctx: Context): Promise<User | null> {
    const user = await this.users.findByChatId(this.chatId(ctx));
    if (!user) {
      await ctx.reply(NOT_REGISTERED_REPLY);
      return null;
    }
    return user;
  }
}
