import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
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

    await this.getPublisher().publish(
      REALTIME_EVENTS_CHANNEL,
      JSON.stringify(event),
    );
  }

  async onApplicationShutdown() {
    if (!this.publisher) {
      return;
    }

    await this.publisher.quit();
  }

  private getPublisher() {
    if (!this.publisher) {
      this.publisher = new Redis({
        host: this.configService.getOrThrow<string>('REDIS_HOST'),
        port: this.configService.getOrThrow<number>('REDIS_PORT'),
      });

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
