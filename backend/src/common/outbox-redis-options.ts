import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export const OUTBOX_REDIS_TIMEOUT_MS = 2_000;

// Producers retry through their durable outboxes. Do not let an offline Redis
// connection hold a dispatch (or shutdown) open indefinitely. Workers keep their
// separate persistent connection policy.
export const createOutboxRedisOptions = (
  config: ConfigService,
): RedisOptions => ({
  host: config.getOrThrow<string>('REDIS_HOST'),
  port: config.getOrThrow<number>('REDIS_PORT'),
  connectTimeout: OUTBOX_REDIS_TIMEOUT_MS,
  commandTimeout: OUTBOX_REDIS_TIMEOUT_MS,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
