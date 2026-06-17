export const SETKEYS_SCENE_ID = 'setkeys';

/** Conversation/session TTL — abandoned wizards expire after this. */
export const SESSION_TTL_SECONDS = 15 * 60;

export const HELP_TEXT = [
  'Available commands:',
  '/start — register',
  '/setkeys — connect your Binance API keys',
  '/status — check your setup',
  '/deletekeys — remove stored keys',
  '/help — show this message',
].join('\n');

export const NOT_REGISTERED_REPLY = 'You are not registered yet. Send /start first.';
