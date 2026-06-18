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
