import { Command, Ctx, Wizard, WizardStep } from 'nestjs-telegraf';
import type { Scenes } from 'telegraf';
import { UsersService } from '../../users/users.service';
import { BinanceKeyService } from '../../users/binance-key.service';
import { SETKEYS_SCENE_ID } from '../telegram.constants';
import { isPlausibleBinanceKey } from '../key-format';

interface SetkeysState {
  apiKey?: string;
}

type WizardCtx = Scenes.WizardContext & { wizard: { state: SetkeysState } };

@Wizard(SETKEYS_SCENE_ID)
export class SetkeysWizard {
  constructor(
    private readonly users: UsersService,
    private readonly keys: BinanceKeyService,
  ) {}

  @WizardStep(1)
  async step1Prompt(@Ctx() ctx: WizardCtx): Promise<void> {
    await ctx.reply('Send your Binance API key. Send /cancel to abort.');
    ctx.wizard.next();
  }

  @WizardStep(2)
  async step2ApiKey(@Ctx() ctx: WizardCtx): Promise<void> {
    const text = this.extractText(ctx);
    if (await this.handleCommand(ctx, text)) return;
    await this.tryDelete(ctx);

    if (!text || !isPlausibleBinanceKey(text)) {
      await ctx.reply('That does not look like a valid API key (64 characters). Try again, or /cancel.');
      return;
    }

    ctx.wizard.state.apiKey = text;
    await ctx.reply('Got it. Now send your Binance API secret.');
    ctx.wizard.next();
  }

  @WizardStep(3)
  async step3Secret(@Ctx() ctx: WizardCtx): Promise<void> {
    const text = this.extractText(ctx);
    if (await this.handleCommand(ctx, text)) return;
    await this.tryDelete(ctx);

    if (!text || !isPlausibleBinanceKey(text)) {
      await ctx.reply('That does not look like a valid API secret (64 characters). Try again, or /cancel.');
      return;
    }

    const apiKey = ctx.wizard.state.apiKey;
    if (!apiKey || !ctx.from) {
      await ctx.reply('Something went wrong — please start over with /setkeys.');
      await ctx.scene.leave();
      return;
    }

    const user = await this.users.findOrCreate(String(ctx.from.id));
    await this.keys.upsertKey(user.id, apiKey, text);
    // Clear the plaintext key from session state so it does not linger in Redis
    // until the session TTL expires.
    ctx.wizard.state.apiKey = undefined;
    await ctx.reply('Your Binance API keys are saved securely. ✅');
    await ctx.scene.leave();
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: WizardCtx): Promise<void> {
    await ctx.reply('Cancelled. Your keys were not changed.');
    await ctx.scene.leave();
  }

  /**
   * If the incoming message is a command (starts with '/'), handle it without
   * treating it as key input and without deleting it: '/cancel' leaves the scene,
   * any other command nudges the user to finish or cancel first. Returns true if
   * the message was a command (the caller should then stop processing the step).
   */
  private async handleCommand(ctx: WizardCtx, text: string | undefined): Promise<boolean> {
    if (!text || !text.startsWith('/')) {
      return false;
    }
    if (text === '/cancel') {
      await ctx.reply('Cancelled. Your keys were not changed.');
      await ctx.scene.leave();
    } else {
      await ctx.reply('You are mid-setup. Send /cancel to abort, then retry your command.');
    }
    return true;
  }

  private extractText(ctx: WizardCtx): string | undefined {
    const message = ctx.message as { text?: string } | undefined;
    return message?.text;
  }

  private async tryDelete(ctx: WizardCtx): Promise<void> {
    try {
      await ctx.deleteMessage();
    } catch {
      // Best effort: in a private chat a bot may delete incoming messages, but if
      // it fails (e.g. message too old) we must not block saving the keys.
    }
  }
}
