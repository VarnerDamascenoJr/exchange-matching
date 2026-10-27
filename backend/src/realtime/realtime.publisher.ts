import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createOutboxRedisOptions } from '../common/outbox-redis-options';
import { REALTIME_EVENTS_CHANNEL } from './realtime.constants';
import { RealtimeDispatchEvent } from './realtime.types';

@Injectable()
export class RealtimePublisherService implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimePublisherService.name);
  private publisher?: Redis;

  constructor(private readonly configService: ConfigService) {}

  async publishEvent(event: RealtimeDispatchEvent) {
    if (!this.shouldRunRealtime()) {
      return;
    }

    const publisher = this.getPublisher();
    try {
      await publisher.publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (error) {
      if (this.publisher === publisher) {
        this.publisher = undefined;
      }
      publisher.disconnect();
      throw error;
    }
  }

  async onApplicationShutdown() {
    if (!this.publisher) {
      return;
    }

    const publisher = this.publisher;
    this.publisher = undefined;
    try {
      await publisher.quit();
    } catch (error) {
      publisher.disconnect();
      this.logger.error(
        'Failed to close realtime publisher gracefully',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private getPublisher() {
    if (!this.publisher) {
      this.publisher = new Redis(createOutboxRedisOptions(this.configService));

      this.publisher.on('error', (error) => {
        this.logger.error(
          `Realtime publisher Redis error: ${error.message}`,
          error.stack,
        );
      });
    }

    return this.publisher;
  }

  private shouldRunRealtime(): boolean {
    return (
      this.configService.get<string>('NODE_ENV') !== 'test' ||
      this.configService.get<boolean>('RUN_DATABASE_E2E') === true
    );
  }
}
