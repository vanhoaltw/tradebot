# Users & Key Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `User` and `BinanceKey` TypeORM entities, their services, a database migration, and a `UsersModule` so downstream modules can register Telegram users and retrieve decrypted Binance API credentials.

**Architecture:** Two entities in `src/users/` — `User` (Telegram chat ID, role, active flag) and `BinanceKey` (AES-256-GCM encrypted credentials, FK to user). `UsersService` handles find-or-create by Telegram ID and role updates. `BinanceKeyService` encrypts keys on write and decrypts on read using the global `EncryptionService`. A single handwritten TypeORM migration creates both tables. `UsersModule` exports both services and is registered in `AppModule`.

**Tech Stack:** NestJS 11, TypeORM 1.0.0, PostgreSQL, AES-256-GCM (`EncryptionService` is `@Global()` — already available everywhere), Jest + `@nestjs/testing`.

---

## Setup

- [ ] Create and checkout the feature branch:
```bash
git checkout -b feat/users
```

---

## Task 1: User Entity

**Files:**
- Create: `src/users/user.entity.ts`

- [ ] **Step 1: Write the entity**

```typescript
// src/users/user.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  Admin = 'admin',
  User = 'user',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** PostgreSQL BIGINT; TypeORM returns bigint columns as string in JS. */
  @Column({ type: 'bigint', unique: true, name: 'telegram_chat_id' })
  telegramChatId!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.User,
    enumName: 'user_role_enum',
  })
  role!: UserRole;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Verify TypeScript compiles**
```bash
pnpm build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**
```bash
git add src/users/user.entity.ts
git commit -m "feat(users): add User entity"
```

---

## Task 2: BinanceKey Entity

**Files:**
- Create: `src/users/binance-key.entity.ts`

- [ ] **Step 1: Write the entity**

```typescript
// src/users/binance-key.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('binance_keys')
export class BinanceKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'encrypted_api_key', type: 'text' })
  encryptedApiKey!: string;

  @Column({ name: 'encrypted_secret', type: 'text' })
  encryptedSecret!: string;

  @Column({ nullable: true, type: 'text' })
  label?: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Verify TypeScript compiles**
```bash
pnpm build
```
Expected: exits 0.

- [ ] **Step 3: Commit**
```bash
git add src/users/binance-key.entity.ts
git commit -m "feat(users): add BinanceKey entity"
```

---

## Task 3: Database Migration

**Files:**
- Create: `src/database/migrations/1781654400000-CreateUsersAndKeys.ts`

- [ ] **Step 1: Write the migration**

```typescript
// src/database/migrations/1781654400000-CreateUsersAndKeys.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndKeys1781654400000 implements MigrationInterface {
  name = 'CreateUsersAndKeys1781654400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE user_role_enum AS ENUM ('admin', 'user')`,
    );
    await queryRunner.query(`
      CREATE TABLE users (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_chat_id BIGINT      NOT NULL UNIQUE,
        role             user_role_enum NOT NULL DEFAULT 'user',
        is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE binance_keys (
        id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        encrypted_api_key TEXT    NOT NULL,
        encrypted_secret  TEXT    NOT NULL,
        label             TEXT,
        is_active         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_binance_keys_user_id ON binance_keys(user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_binance_keys_user_id`);
    await queryRunner.query(`DROP TABLE binance_keys`);
    await queryRunner.query(`DROP TABLE users`);
    await queryRunner.query(`DROP TYPE user_role_enum`);
  }
}
```

- [ ] **Step 2: Run the migration** (requires PostgreSQL running with `DATABASE_URL` in `.env`)
```bash
pnpm run migration:run
```
Expected output contains: `Migration CreateUsersAndKeys1781654400000 has been executed successfully.`

- [ ] **Step 3: Spot-check tables**
```bash
psql "$DATABASE_URL" -c "\dt users" -c "\dt binance_keys"
```
Expected: both tables listed.

- [ ] **Step 4: Commit**
```bash
git add src/database/migrations/1781654400000-CreateUsersAndKeys.ts
git commit -m "feat(users): add migration for users and binance_keys tables"
```

---

## Task 4: UsersService

**Files:**
- Create: `src/users/users.service.spec.ts`
- Create: `src/users/users.service.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/users/users.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, UserRole } from './user.entity';
import { UsersService } from './users.service';

const mockRepo = () => ({
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(UsersService);
    repo = module.get(getRepositoryToken(User));
  });

  describe('findByChatId', () => {
    it('returns user when found', async () => {
      const user = { id: 'u1', telegramChatId: '123' } as User;
      repo.findOneBy.mockResolvedValue(user);

      await expect(service.findByChatId('123')).resolves.toBe(user);
      expect(repo.findOneBy).toHaveBeenCalledWith({ telegramChatId: '123' });
    });

    it('returns null when not found', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.findByChatId('999')).resolves.toBeNull();
    });
  });

  describe('findOrCreate', () => {
    it('returns existing user without saving', async () => {
      const user = { id: 'u1', telegramChatId: '123' } as User;
      repo.findOneBy.mockResolvedValue(user);

      await expect(service.findOrCreate('123')).resolves.toBe(user);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('creates and saves new user when not found', async () => {
      const newUser = { id: 'u2', telegramChatId: '999' } as User;
      repo.findOneBy.mockResolvedValue(null);
      repo.create.mockReturnValue(newUser);
      repo.save.mockResolvedValue(newUser);

      await expect(service.findOrCreate('999')).resolves.toBe(newUser);
      expect(repo.create).toHaveBeenCalledWith({ telegramChatId: '999' });
      expect(repo.save).toHaveBeenCalledWith(newUser);
    });
  });

  describe('setRole', () => {
    it('calls update with the provided role', async () => {
      repo.update.mockResolvedValue({ affected: 1 });

      await service.setRole('u1', UserRole.Admin);

      expect(repo.update).toHaveBeenCalledWith('u1', { role: UserRole.Admin });
    });
  });

  describe('deactivate', () => {
    it('sets isActive to false', async () => {
      repo.update.mockResolvedValue({ affected: 1 });

      await service.deactivate('u1');

      expect(repo.update).toHaveBeenCalledWith('u1', { isActive: false });
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (no service yet)**
```bash
pnpm test -- users.service.spec.ts
```
Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 3: Implement UsersService**

```typescript
// src/users/users.service.ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**
```bash
pnpm test -- users.service.spec.ts
```
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**
```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat(users): add UsersService with find-or-create and role management"
```

---

## Task 5: BinanceKeyService

**Files:**
- Create: `src/users/binance-key.service.spec.ts`
- Create: `src/users/binance-key.service.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/users/binance-key.service.spec.ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**
```bash
pnpm test -- binance-key.service.spec.ts
```
Expected: FAIL — `Cannot find module './binance-key.service'`

- [ ] **Step 3: Implement BinanceKeyService**

```typescript
// src/users/binance-key.service.ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**
```bash
pnpm test -- binance-key.service.spec.ts
```
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**
```bash
git add src/users/binance-key.service.ts src/users/binance-key.service.spec.ts
git commit -m "feat(users): add BinanceKeyService with encrypted key custody"
```

---

## Task 6: UsersModule + AppModule Wiring

**Files:**
- Create: `src/users/users.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinanceKey } from './binance-key.entity';
import { BinanceKeyService } from './binance-key.service';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, BinanceKey])],
  providers: [UsersService, BinanceKeyService],
  exports: [UsersService, BinanceKeyService],
})
export class UsersModule {}
```

`EncryptionModule` is `@Global()`, so `EncryptionService` is injectable in `BinanceKeyService` without being listed here.

- [ ] **Step 2: Register UsersModule in AppModule**

Replace `src/app.module.ts` with:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { RedisModule } from './common/redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    EncryptionModule,
    RedisModule,
    DatabaseModule,
    QueueModule,
    HealthModule,
    UsersModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Build and run all tests**
```bash
pnpm build && pnpm test
```
Expected: build exits 0, all tests pass (including pre-existing health/encryption/config specs).

- [ ] **Step 4: Commit**
```bash
git add src/users/users.module.ts src/app.module.ts
git commit -m "feat(users): add UsersModule and register in AppModule"
```

---

## Self-Review

**Spec coverage:**
- [x] User entity: Telegram chat ID (bigint-as-string), role enum, active flag, timestamps — Task 1
- [x] BinanceKey entity: encrypted credentials, userId FK, label, active flag — Task 2
- [x] Migration: creates both tables with proper constraints and index — Task 3
- [x] UsersService: `findByChatId`, `findOrCreate`, `setRole`, `deactivate` — Task 4
- [x] BinanceKeyService: `upsertKey` (encrypt-on-write), `getActiveKey` (decrypt-on-read), `deleteKeys` — Task 5
- [x] UsersModule wired into AppModule; exports both services for downstream use — Task 6

**Placeholder scan:** Clean — no TBDs, no handwaves, all steps have exact code or commands.

**Type consistency:**
- `telegramChatId` is `string` throughout (bigint-as-string convention)
- `userId` is `string` (UUID) in entity, service parameters, and tests
- `UserRole.Admin` / `UserRole.User` enum used consistently
- `{ apiKey, secret }` return shape matches between service implementation and test assertions
