import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { setTimeout as delay } from 'node:timers/promises';
import { ORDER_MATCHING_QUEUE_NAME } from '../src/queue/order-matching.constants';
import { OrderMatchingProcessor } from '../src/queue/order-matching.processor';
import { OrderMatchingQueueService } from '../src/queue/order-matching.queue';
import { ProcessOrderJobData } from '../src/queue/order-matching.types';
import { OrderMatchingWorker } from '../src/queue/order-matching.worker';
import { createRedisConnection } from '../src/queue/redis-connection.factory';

// Isolate the real Redis queue from application jobs and other test runs.
jest.mock('../src/queue/order-matching.constants', () => ({
  ...jest.requireActual<typeof import('../src/queue/order-matching.constants')>(
    '../src/queue/order-matching.constants',
  ),
  ORDER_MATCHING_QUEUE_NAME: `order-matching-e2e-${process.pid}-${Date.now()}`,
}));

const describeRedis =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

async function waitFor(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await delay(20);
  }
  throw new Error('Timed out waiting for matching queue state');
}

describeRedis('Order matching global concurrency (e2e)', () => {
  it('processes only one job at a time across two worker instances', async () => {
    const config = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
      REDIS_PORT: Number(process.env.REDIS_PORT ?? 6379),
    });
    const queue = new Queue<ProcessOrderJobData>(ORDER_MATCHING_QUEUE_NAME, {
      connection: createRedisConnection(config),
    });
    const queueServices = [
      new OrderMatchingQueueService(config),
      new OrderMatchingQueueService(config),
    ];
    let releaseJobs!: () => void;
    const jobGate = new Promise<void>((resolve) => {
      releaseJobs = resolve;
    });
    let activeJobs = 0;
    let maximumActiveJobs = 0;
    const startedOrders: string[] = [];
    const processor = {
      process: async (job: Job<ProcessOrderJobData>) => {
        activeJobs++;
        maximumActiveJobs = Math.max(maximumActiveJobs, activeJobs);
        startedOrders.push(job.data.orderId);
        await jobGate;
        activeJobs--;
      },
    };
    const workers = queueServices.map(
      (queueService) =>
        new OrderMatchingWorker(
          config,
          processor as unknown as OrderMatchingProcessor,
          queueService,
        ),
    );

    try {
      // Startup must also correct a previously configured, higher limit.
      await queue.setGlobalConcurrency(2);
      await Promise.all(workers.map((worker) => worker.onModuleInit()));
      expect(await queue.getGlobalConcurrency()).toBe(1);
      await waitFor(async () => (await queue.getWorkers()).length === 2);

      await Promise.all(
        ['order-1', 'order-2', 'order-3', 'order-4'].map((orderId) =>
          queueServices[0].enqueueProcessOrder(orderId),
        ),
      );
      await waitFor(() => startedOrders.length > 0);

      // Keep the first job active while both consumers can request more work.
      await delay(250);
      expect(startedOrders).toHaveLength(1);
      expect(await queue.getActiveCount()).toBe(1);
      expect(await queue.getWaitingCount()).toBe(3);

      releaseJobs();
      await waitFor(async () => (await queue.getCompletedCount()) === 4);
      expect(startedOrders.sort()).toEqual([
        'order-1',
        'order-2',
        'order-3',
        'order-4',
      ]);
      expect(maximumActiveJobs).toBe(1);
    } finally {
      releaseJobs();
      try {
        await Promise.all(
          workers.map((worker) => worker.onApplicationShutdown()),
        );
      } finally {
        await Promise.all(
          queueServices.map((service) => service.onApplicationShutdown()),
        );
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queue.close();
        }
      }
    }
  }, 15_000);
});
