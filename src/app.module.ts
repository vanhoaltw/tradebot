import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { RedisModule } from './common/redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    EncryptionModule,
    RedisModule,
    DatabaseModule,
    QueueModule,
    HealthModule,
  ],
})
export class AppModule {}
