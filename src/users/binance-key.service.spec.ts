import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EncryptionService } from '../common/encryption/encryption.service';
import { BinanceKey } from './binance-key.entity';
import { BinanceKeyService } from './binance-key.service';

const mockKeyRepo = () => ({
  update: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  findOneBy: jest.fn(),
  delete: jest.fn(),
});

const mockEncryption = () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
});

describe('BinanceKeyService', () => {
  let service: BinanceKeyService;
  let keyRepo: ReturnType<typeof mockKeyRepo>;
  let encryption: ReturnType<typeof mockEncryption>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BinanceKeyService,
        { provide: getRepositoryToken(BinanceKey), useFactory: mockKeyRepo },
        { provide: EncryptionService, useFactory: mockEncryption },
      ],
    }).compile();

    service = module.get(BinanceKeyService);
    keyRepo = module.get(getRepositoryToken(BinanceKey));
    encryption = module.get(EncryptionService);
  });

  describe('upsertKey', () => {
    it('deactivates existing keys then saves new encrypted record', async () => {
      encryption.encrypt
        .mockReturnValueOnce('enc_api_key')
        .mockReturnValueOnce('enc_secret');
      const record = { id: 'k1' } as BinanceKey;
      keyRepo.update.mockResolvedValue({ affected: 0 });
      keyRepo.create.mockReturnValue(record);
      keyRepo.save.mockResolvedValue(record);

      await service.upsertKey('u1', 'MY_API_KEY', 'MY_SECRET');

      expect(keyRepo.update).toHaveBeenCalledWith(
        { userId: 'u1', isActive: true },
        { isActive: false },
      );
      expect(encryption.encrypt).toHaveBeenNthCalledWith(1, 'MY_API_KEY');
      expect(encryption.encrypt).toHaveBeenNthCalledWith(2, 'MY_SECRET');
      expect(keyRepo.create).toHaveBeenCalledWith({
        userId: 'u1',
        encryptedApiKey: 'enc_api_key',
        encryptedSecret: 'enc_secret',
        label: undefined,
        isActive: true,
      });
      expect(keyRepo.save).toHaveBeenCalledWith(record);
      expect(keyRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
        keyRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('passes optional label through to the record', async () => {
      encryption.encrypt.mockReturnValueOnce('e1').mockReturnValueOnce('e2');
      keyRepo.update.mockResolvedValue({ affected: 0 });
      const record = { id: 'k2' } as BinanceKey;
      keyRepo.create.mockReturnValue(record);
      keyRepo.save.mockResolvedValue(record);

      await service.upsertKey('u1', 'KEY', 'SEC', 'main-account');

      expect(keyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'main-account' }),
      );
    });
  });

  describe('getActiveKey', () => {
    it('returns null when no active key exists for user', async () => {
      keyRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getActiveKey('u1')).resolves.toBeNull();
    });

    it('decrypts and returns active key credentials', async () => {
      keyRepo.findOneBy.mockResolvedValue({
        encryptedApiKey: 'enc_k',
        encryptedSecret: 'enc_s',
      } as BinanceKey);
      encryption.decrypt
        .mockReturnValueOnce('plain_key')
        .mockReturnValueOnce('plain_secret');

      const result = await service.getActiveKey('u1');

      expect(keyRepo.findOneBy).toHaveBeenCalledWith({ userId: 'u1', isActive: true });
      expect(result).toEqual({ apiKey: 'plain_key', secret: 'plain_secret' });
    });
  });

  describe('deleteKeys', () => {
    it('deletes all key records for the user', async () => {
      keyRepo.delete.mockResolvedValue({ affected: 2 });

      await service.deleteKeys('u1');

      expect(keyRepo.delete).toHaveBeenCalledWith({ userId: 'u1' });
    });
  });
});
