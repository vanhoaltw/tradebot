import { SetkeysWizard } from './setkeys.wizard';

const VALID = 'a'.repeat(64);

const makeServices = () => ({
  users: { findOrCreate: jest.fn() },
  keys: { upsertKey: jest.fn() },
});

// Minimal mock of the Telegraf WizardContext surface the wizard touches.
const makeCtx = (text?: string) => ({
  from: { id: 123 },
  message: text === undefined ? undefined : { text, message_id: 7 },
  reply: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(true),
  wizard: { state: {} as Record<string, unknown>, next: jest.fn() },
  scene: { leave: jest.fn().mockResolvedValue(undefined) },
});

describe('SetkeysWizard', () => {
  let services: ReturnType<typeof makeServices>;
  let wizard: SetkeysWizard;

  beforeEach(() => {
    services = makeServices();
    wizard = new SetkeysWizard(services.users as never, services.keys as never);
  });

  describe('step 1 (prompt)', () => {
    it('asks for the API key and advances', async () => {
      const ctx = makeCtx();
      await wizard.step1Prompt(ctx as never);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      expect(ctx.reply.mock.calls[0][0]).toMatch(/API key/i);
      expect(ctx.wizard.next).toHaveBeenCalled();
    });
  });

  describe('step 2 (API key)', () => {
    it('deletes the message, stores the key, and advances on valid input', async () => {
      const ctx = makeCtx(VALID);
      await wizard.step2ApiKey(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(ctx.wizard.state.apiKey).toBe(VALID);
      expect(ctx.wizard.next).toHaveBeenCalled();
    });

    it('re-prompts and does not advance on invalid input', async () => {
      const ctx = makeCtx('too-short');
      await wizard.step2ApiKey(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled(); // still delete, in case it was a real secret
      expect(ctx.wizard.state.apiKey).toBeUndefined();
      expect(ctx.wizard.next).not.toHaveBeenCalled();
      expect(ctx.reply.mock.calls[0][0]).toMatch(/again|invalid/i);
    });
  });

  describe('step 3 (API secret)', () => {
    it('stores encrypted keys and leaves the scene on valid input', async () => {
      services.users.findOrCreate.mockResolvedValue({ id: 'user-uuid' });
      services.keys.upsertKey.mockResolvedValue(undefined);
      const ctx = makeCtx(VALID);
      ctx.wizard.state.apiKey = VALID;

      await wizard.step3Secret(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(services.users.findOrCreate).toHaveBeenCalledWith('123');
      expect(services.keys.upsertKey).toHaveBeenCalledWith('user-uuid', VALID, VALID);
      expect(ctx.scene.leave).toHaveBeenCalled();
    });

    it('re-prompts and does not store on invalid input', async () => {
      const ctx = makeCtx('nope');
      ctx.wizard.state.apiKey = VALID;

      await wizard.step3Secret(ctx as never);

      expect(ctx.deleteMessage).toHaveBeenCalled();
      expect(services.keys.upsertKey).not.toHaveBeenCalled();
      expect(ctx.scene.leave).not.toHaveBeenCalled();
      expect(ctx.reply.mock.calls[0][0]).toMatch(/again|invalid/i);
    });
  });

  describe('onCancel', () => {
    it('leaves the scene', async () => {
      const ctx = makeCtx();
      await wizard.onCancel(ctx as never);

      expect(ctx.scene.leave).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalled();
    });
  });
});
