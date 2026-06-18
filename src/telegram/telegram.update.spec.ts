import { TelegramUpdate } from './telegram.update';

const makeServices = () => ({
  users: { findOrCreate: jest.fn(), findByChatId: jest.fn() },
  keys: { hasActiveKey: jest.fn(), deleteKeys: jest.fn() },
});

const makeCtx = () => ({
  from: { id: 123 },
  reply: jest.fn().mockResolvedValue(undefined),
  scene: { enter: jest.fn().mockResolvedValue(undefined) },
});

describe('TelegramUpdate', () => {
  let services: ReturnType<typeof makeServices>;
  let update: TelegramUpdate;

  beforeEach(() => {
    services = makeServices();
    update = new TelegramUpdate(services.users as never, services.keys as never);
  });

  describe('/start', () => {
    it('registers the user and welcomes them', async () => {
      services.users.findOrCreate.mockResolvedValue({ id: 'u1' });
      const ctx = makeCtx();

      await update.onStart(ctx as never);

      expect(services.users.findOrCreate).toHaveBeenCalledWith('123');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/setkeys/i);
    });
  });

  describe('/setkeys', () => {
    it('enters the setkeys scene', async () => {
      const ctx = makeCtx();
      await update.onSetkeys(ctx as never);
      expect(ctx.scene.enter).toHaveBeenCalledWith('setkeys');
    });
  });

  describe('/status', () => {
    it('prompts /start when the user is not registered', async () => {
      services.users.findByChatId.mockResolvedValue(null);
      const ctx = makeCtx();

      await update.onStatus(ctx as never);

      expect(ctx.reply.mock.calls[0][0]).toMatch(/start/i);
      expect(services.keys.hasActiveKey).not.toHaveBeenCalled();
    });

    it('reports configured keys', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.hasActiveKey.mockResolvedValue(true);
      const ctx = makeCtx();

      await update.onStatus(ctx as never);

      expect(services.keys.hasActiveKey).toHaveBeenCalledWith('u1');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/configured/i);
    });

    it('reports missing keys', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.hasActiveKey.mockResolvedValue(false);
      const ctx = makeCtx();

      await update.onStatus(ctx as never);

      expect(ctx.reply.mock.calls[0][0]).toMatch(/not set/i);
    });
  });

  describe('/deletekeys', () => {
    it('prompts /start when the user is not registered', async () => {
      services.users.findByChatId.mockResolvedValue(null);
      const ctx = makeCtx();

      await update.onDeleteKeys(ctx as never);

      expect(services.keys.deleteKeys).not.toHaveBeenCalled();
      expect(ctx.reply.mock.calls[0][0]).toMatch(/start/i);
    });

    it('deletes stored keys for a registered user', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.deleteKeys.mockResolvedValue(true);
      const ctx = makeCtx();

      await update.onDeleteKeys(ctx as never);

      expect(services.keys.deleteKeys).toHaveBeenCalledWith('u1');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/removed/i);
    });

    it('tells the user when there were no keys to remove', async () => {
      services.users.findByChatId.mockResolvedValue({ id: 'u1' });
      services.keys.deleteKeys.mockResolvedValue(false);
      const ctx = makeCtx();

      await update.onDeleteKeys(ctx as never);

      expect(services.keys.deleteKeys).toHaveBeenCalledWith('u1');
      expect(ctx.reply.mock.calls[0][0]).toMatch(/no stored|no api keys/i);
    });
  });

  describe('/help and fallback', () => {
    it('replies with help text listing commands', async () => {
      const ctx = makeCtx();
      await update.onHelp(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/\/setkeys/);
    });

    it('nudges unknown text toward /help', async () => {
      const ctx = makeCtx();
      await update.onText(ctx as never);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/help/i);
    });
  });
});
