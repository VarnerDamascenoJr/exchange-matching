import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import {
  ORDER_MATCHING_CONCURRENCY,
  ORDER_MATCHING_QUEUE_NAME,
} from './order-matching.constants';
import { OrderMatchingProcessor } from './order-matching.processor';
import { ProcessOrderJobData } from './order-matching.types';
import { createRedisConnection } from './redis-connection.factory';

@Injectable()
export class OrderMatchingWorker
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(OrderMatchingWorker.name);
  private worker?: Worker<ProcessOrderJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly orderMatchingProcessor: OrderMatchingProcessor,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ProcessOrderJobData>(
      ORDER_MATCHING_QUEUE_NAME,
      async (job) => this.orderMatchingProcessor.process(job),
      {
        connection: createRedisConnection(this.configService),
        concurrency: ORDER_MATCHING_CONCURRENCY,
      },
    );

    this.worker.on('completed', (job: Job<ProcessOrderJobData>) => {
      this.logger.log(`Completed job ${job.id} for order ${job.data.orderId}`);
    });

    this.worker.on(
      'failed',
      (job: Job<ProcessOrderJobData> | undefined, error: Error) => {
        this.logger.error(
          `Failed job ${job?.id ?? 'unknown'} for order ${job?.data.orderId ?? 'unknown'}`,
          error.stack,
        );
      },
    );

    this.logger.log(
      `Worker started for queue ${ORDER_MATCHING_QUEUE_NAME} with concurrency ${ORDER_MATCHING_CONCURRENCY}`,
    );
  }

  async onApplicationShutdown() {
    if (!this.worker) {
      return;
    }

    await this.worker.close();
  }
}
