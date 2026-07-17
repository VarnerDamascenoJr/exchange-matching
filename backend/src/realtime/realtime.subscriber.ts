import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REALTIME_EVENTS_CHANNEL } from './realtime.constants';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeDispatchEvent } from './realtime.types';

@Injectable()
export class RealtimeSubscriberService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeSubscriberService.name);
  private subscriber?: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async onModuleInit() {
    if (!this.shouldRunRealtime()) {
      return;
    }

    const subscriber = this.getSubscriber();

    subscriber.on('message', (channel, message) => {
      if (channel !== REALTIME_EVENTS_CHANNEL) {
        return;
      }

      try {
        const event = JSON.parse(message) as RealtimeDispatchEvent;
        this.realtimeGateway.dispatchEvent(event);
      } catch (error) {
        this.logger.error(
          'Failed to parse realtime message',
          error instanceof Error ? error.stack : undefined,
        );
      }
    });

    await subscriber.subscribe(REALTIME_EVENTS_CHANNEL);
  }

  async onModuleDestroy() {
    if (!this.subscriber) {
      return;
    }

    await this.subscriber.quit();
  }

  private getSubscriber() {
    if (!this.subscriber) {
      this.subscriber = new Redis({
        host: this.configService.getOrThrow<string>('REDIS_HOST'),
        port: this.configService.getOrThrow<number>('REDIS_PORT'),
      });

      this.subscriber.on('error', (error) => {
        this.logger.error(
          `Realtime subscriber Redis error: ${error.message}`,
          error.stack,
        );
      });
    }

    return this.subscriber;
  }

  private shouldRunRealtime(): boolean {
    return (
      this.configService.get<string>('NODE_ENV') !== 'test' ||
      this.configService.get<boolean>('RUN_DATABASE_E2E') === true
    );
  }
}
