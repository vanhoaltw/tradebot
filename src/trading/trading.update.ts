// src/trading/trading.update.ts
import { Command, Ctx, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { NOT_REGISTERED_REPLY } from '../telegram/telegram.constants';
import { NO_KEYS_REPLY } from './trading.constants';
import { parseBuyArgs, parseSellArgs } from './trade-args';
import {
  TradingService,
  BalancesResult,
  BuyResult,
  SellResult,
} from './trading.service';
import { Balance } from './binance.service';

@Update()
export class TradingUpdate {
  constructor(
    private readonly users: UsersService,
    private readonly trading: TradingService,
  ) {}

  @Command('balance')
  async onBalance(@Ctx() ctx: Context): Promise<void> {
    const user = await this.requireUser(ctx);
    if (!user) return;
    const result = await this.trading.getBalances(user.id);
    await ctx.reply(this.formatBalances(result));
  }

  @Command('buy')
  async onBuy(@Ctx() ctx: Context): Promise<void> {
    const user = await this.requireUser(ctx);
    if (!user) return;
    let args;
    try {
      args = parseBuyArgs(this.text(ctx));
    } catch (err) {
      await ctx.reply((err as Error).message);
      return;
    }
    const result = await this.trading.buy(user.id, args.symbol, args.usdt);
    await ctx.reply(this.formatBuy(result));
  }

  @Command('sell')
  async onSell(@Ctx() ctx: Context): Promise<void> {
    const user = await this.requireUser(ctx);
    if (!user) return;
    let args;
    try {
      args = parseSellArgs(this.text(ctx));
    } catch (err) {
      await ctx.reply((err as Error).message);
      return;
    }
    const result = await this.trading.sell(user.id, args.symbol, args.amount);
    await ctx.reply(this.formatSell(result));
  }

  // --- formatting ---

  private formatBalances(result: BalancesResult): string {
    if (result.kind === 'no_keys') return NO_KEYS_REPLY;
    if (result.balances.length === 0) return 'No non-zero balances on your testnet account.';
    const usdtFirst = [...result.balances].sort((a, b) =>
      a.asset === 'USDT' ? -1 : b.asset === 'USDT' ? 1 : 0,
    );
    const lines = usdtFirst.map((b: Balance) => `${b.asset}: ${b.free}`);
    return ['Your testnet balances:', ...lines].join('\n');
  }

  private formatBuy(result: BuyResult): string {
    if (result.kind === 'no_keys') return NO_KEYS_REPLY;
    if (result.kind === 'rejected') return result.reason;
    const head = `✅ Bought ${result.quantity} ${result.symbol} @ ${result.avgPrice}`;
    const oco = result.oco.placed
      ? 'Protective OCO placed (SL 5% / TP 10%).'
      : `⚠️ Unprotected position — OCO failed: ${result.oco.reason}`;
    return `${head}\n${oco}`;
  }

  private formatSell(result: SellResult): string {
    if (result.kind === 'no_keys') return NO_KEYS_REPLY;
    if (result.kind === 'rejected') return result.reason;
    return `✅ Sold ${result.quantity} ${result.symbol} @ ${result.avgPrice}`;
  }

  // --- helpers (mirrors telegram.update.ts's private requireUser/chatId) ---

  private text(ctx: Context): string {
    const msg = ctx.message as { text?: string } | undefined;
    return msg?.text ?? '';
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
