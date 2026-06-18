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
