import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number;

  // --- Foundation-required ---
  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  /** 32 bytes encoded as 64 hex chars, for AES-256-GCM. */
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
  })
  ENCRYPTION_KEY: string;

  // --- Consumed by later sub-plans (optional now, still validated) ---
  @IsString()
  @IsOptional()
  TELEGRAM_BOT_TOKEN?: string;

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  @IsEnum(['true', 'false'])
  @IsOptional()
  BINANCE_USE_TESTNET?: 'true' | 'false';

  @IsNumber()
  @Min(0)
  @IsOptional()
  MAX_SINGLE_ORDER_USDT?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  MAX_DAILY_SPEND_USDT?: number;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }
  return validated;
}
