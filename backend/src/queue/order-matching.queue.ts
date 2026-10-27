import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import {
  ORDER_MATCHING_GLOBAL_CONCURRENCY,
  ORDER_MATCHING_QUEUE_NAME,
  PROCESS_ORDER_JOB_NAME,
} from './order-matching.constants';
import { ProcessOrderJobData } from './order-matching.types';
import { createOutboxRedisOptions } from '../common/outbox-redis-options';

@Injectable()
export class OrderMatchingQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(OrderMatchingQueueService.name);
  private queue?: Queue<ProcessOrderJobData>;

  constructor(private readonly configService: ConfigService) {}

  async configureGlobalConcurrency(): Promise<void> {
    await this.getQueue().setGlobalConcurrency(
      ORDER_MATCHING_GLOBAL_CONCURRENCY,
    );
  }

  async enqueueProcessOrder(orderId: string): Promise<void> {
    const jobOptions: JobsOptions = {
      jobId: orderId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    };

    const queue = this.getQueue();
    try {
      await queue.add(PROCESS_ORDER_JOB_NAME, { orderId }, jobOptions);
    } catch (error) {
      if (this.queue === queue) {
        this.queue = undefined;
      }
      await this.closeQueue(queue);
      throw error;
    }

    this.logger.log(
      `Enqueued ${PROCESS_ORDER_JOB_NAME} job for order ${orderId}`,
    );
  }

  async onApplicationShutdown() {
    if (!this.queue) {
      return;
    }

    const queue = this.queue;
    this.queue = undefined;
    await this.closeQueue(queue);
  }

  private async closeQueue(queue: Queue<ProcessOrderJobData>): Promise<void> {
    try {
      await queue.close();
    } catch (error) {
      this.logger.error(
        'Failed to close matching queue gracefully',
        error instanceof Error ? error.stack : undefined,
      );
      await queue.disconnect().catch((disconnectError: unknown) => {
        this.logger.error(
          'Failed to disconnect matching queue',
          disconnectError instanceof Error ? disconnectError.stack : undefined,
        );
      });
    }
  }

  private getQueue(): Queue<ProcessOrderJobData> {
    if (!this.queue) {
      this.queue = new Queue<ProcessOrderJobData>(ORDER_MATCHING_QUEUE_NAME, {
        connection: createOutboxRedisOptions(this.configService),
      });
      this.queue.on('error', (error: Error) => {
        this.logger.error(
          `Matching queue Redis error: ${error.message}`,
          error.stack,
        );
      });
    }

    return this.queue;
  }
}
