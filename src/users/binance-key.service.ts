import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../common/encryption/encryption.service';
import { BinanceKey } from './binance-key.entity';

@Injectable()
export class BinanceKeyService {
  constructor(
    @InjectRepository(BinanceKey)
    private readonly keyRepo: Repository<BinanceKey>,
    private readonly encryption: EncryptionService,
  ) {}

  async upsertKey(
    userId: string,
    apiKey: string,
    secret: string,
    label?: string,
  ): Promise<void> {
    await this.keyRepo.update({ userId, isActive: true }, { isActive: false });
    await this.keyRepo.save(
      this.keyRepo.create({
        userId,
        encryptedApiKey: this.encryption.encrypt(apiKey),
        encryptedSecret: this.encryption.encrypt(secret),
        label,
        isActive: true,
      }),
    );
  }

  async getActiveKey(
    userId: string,
  ): Promise<{ apiKey: string; secret: string } | null> {
    const key = await this.keyRepo.findOneBy({ userId, isActive: true });
    if (!key) return null;
    return {
      apiKey: this.encryption.decrypt(key.encryptedApiKey),
      secret: this.encryption.decrypt(key.encryptedSecret),
    };
  }

  async deleteKeys(userId: string): Promise<void> {
    await this.keyRepo.delete({ userId });
  }
}
