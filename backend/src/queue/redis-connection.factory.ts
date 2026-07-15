import { ConfigService } from '@nestjs/config';
import { ConnectionOptions } from 'bullmq';

export function createRedisConnection(
  configService: ConfigService,
): ConnectionOptions {
  return {
    host: configService.getOrThrow<string>('REDIS_HOST'),
    port: configService.getOrThrow<number>('REDIS_PORT'),
  };
}
