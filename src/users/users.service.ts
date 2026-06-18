import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  findByChatId(telegramChatId: string): Promise<User | null> {
    return this.userRepo.findOneBy({ telegramChatId });
  }

  async findOrCreate(telegramChatId: string): Promise<User> {
    // Non-atomic check-then-insert: two concurrent calls for an unknown chat ID
    // could both attempt to save, with the second hitting the unique constraint.
    // Accepted trade-off for a single-bot, low-concurrency workflow.
    const existing = await this.findByChatId(telegramChatId);
    if (existing) return existing;
    return this.userRepo.save(this.userRepo.create({ telegramChatId }));
  }

  async setRole(userId: string, role: UserRole): Promise<void> {
    await this.userRepo.update(userId, { role });
  }

  async deactivate(userId: string): Promise<void> {
    await this.userRepo.update(userId, { isActive: false });
  }
}
