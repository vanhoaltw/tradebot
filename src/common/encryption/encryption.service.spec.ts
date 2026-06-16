import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function serviceWithKey(hexKey: string): EncryptionService {
  const config = { get: () => hexKey } as unknown as ConfigService;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext value', () => {
    const svc = serviceWithKey(KEY_A);
    const secret = 'binance-secret-key-123';
    const ciphertext = svc.encrypt(secret);
    expect(ciphertext).not.toContain(secret);
    expect(svc.decrypt(ciphertext)).toBe(secret);
  });

  it('produces a different ciphertext each time (unique IV)', () => {
    const svc = serviceWithKey(KEY_A);
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('fails to decrypt when the auth tag/ciphertext is tampered', () => {
    const svc = serviceWithKey(KEY_A);
    const ct = svc.encrypt('tamper-me');
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const enc = serviceWithKey(KEY_A);
    const dec = serviceWithKey(KEY_B);
    expect(() => dec.decrypt(enc.encrypt('x'))).toThrow();
  });

  it('throws at construction if the key is not 32 bytes', () => {
    expect(() => serviceWithKey('a'.repeat(10))).toThrow();
  });
});
