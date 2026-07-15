import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import {
  ORDER_MATCHING_QUEUE_NAME,
  PROCESS_ORDER_JOB_NAME,
} from './order-matching.constants';
import { ProcessOrderJobData } from './order-matching.types';
import { createRedisConnection } from './redis-connection.factory';

@Injectable()
export class OrderMatchingQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(OrderMatchingQueueService.name);
  private queue?: Queue<ProcessOrderJobData>;

  constructor(private readonly configService: ConfigService) {}

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

    await this.getQueue().add(PROCESS_ORDER_JOB_NAME, { orderId }, jobOptions);

    this.logger.log(
      `Enqueued ${PROCESS_ORDER_JOB_NAME} job for order ${orderId}`,
    );
  }

  async onApplicationShutdown() {
    if (!this.queue) {
      return;
    }

    await this.queue.close();
  }

  private getQueue(): Queue<ProcessOrderJobData> {
    if (!this.queue) {
      this.queue = new Queue<ProcessOrderJobData>(ORDER_MATCHING_QUEUE_NAME, {
        connection: createRedisConnection(this.configService),
      });
    }

    return this.queue;
  }
}
