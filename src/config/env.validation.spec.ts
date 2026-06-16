import { validate } from './env.validation';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/tradebot',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('validate (env)', () => {
  it('accepts a valid environment and coerces PORT to a number', () => {
    const result = validate(valid);
    expect(result.PORT).toBe(3000);
    expect(typeof result.PORT).toBe('number');
  });

  it('rejects an ENCRYPTION_KEY that is not 64 hex chars', () => {
    expect(() => validate({ ...valid, ENCRYPTION_KEY: 'tooshort' })).toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    const incomplete = { ...valid };
    delete (incomplete as Partial<typeof valid>).DATABASE_URL;
    expect(() => validate(incomplete)).toThrow();
  });

  it('rejects a non-hex ENCRYPTION_KEY of correct length', () => {
    expect(() =>
      validate({ ...valid, ENCRYPTION_KEY: 'z'.repeat(64) }),
    ).toThrow();
  });
});
