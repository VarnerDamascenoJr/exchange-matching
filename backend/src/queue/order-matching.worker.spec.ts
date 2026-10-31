import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { EventEmitter } from 'node:events';
import { ORDER_MATCHING_QUEUE_NAME } from './order-matching.constants';
import { OrderMatchingProcessor } from './order-matching.processor';
import { OrderMatchingQueueService } from './order-matching.queue';
import { OrderMatchingWorker } from './order-matching.worker';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));

describe('OrderMatchingWorker', () => {
  let service: OrderMatchingWorker;
  let queue: { configureGlobalConcurrency: jest.Mock };
  let processor: { process: jest.Mock };
  let worker: EventEmitter & { close: jest.Mock };
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    queue = {
      configureGlobalConcurrency: jest.fn().mockResolvedValue(undefined),
    };
    processor = { process: jest.fn().mockResolvedValue(undefined) };
    worker = Object.assign(new EventEmitter(), {
      close: jest.fn().mockResolvedValue(undefined),
    });
    jest.mocked(Worker).mockImplementation(() => worker as unknown as Worker);
    service = new OrderMatchingWorker(
      new ConfigService({ REDIS_HOST: 'localhost', REDIS_PORT: 6379 }),
      processor as unknown as OrderMatchingProcessor,
      queue as unknown as OrderMatchingQueueService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([true, false])(
    'handles repeated infrastructure errors without a job (has stack: %s)',
    async (hasStack) => {
      await service.onModuleInit();
      const failure = new Error('Redis connection lost');
      if (!hasStack) {
        failure.stack = undefined;
      }

      expect(() => {
        worker.emit('error', failure);
        worker.emit('error', failure);
      }).not.toThrow();

      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenCalledWith(
        `Matching worker error for queue ${ORDER_MATCHING_QUEUE_NAME}: Redis connection lost`,
        failure.stack,
      );
      expect(processor.process).not.toHaveBeenCalled();
      expect(worker.close).not.toHaveBeenCalled();

      await service.onApplicationShutdown();
      expect(worker.close).toHaveBeenCalledTimes(1);
    },
  );

  it('continues logging job failures with their job and order IDs', async () => {
    await service.onModuleInit();
    const failure = new Error('Matching transaction failed');

    worker.emit(
      'failed',
      { id: 'job-1', data: { orderId: 'order-1' } },
      failure,
    );

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      'Failed job job-1 for order order-1',
      failure.stack,
    );
  });

  it('waits for the shared concurrency limit before starting a consumer', async () => {
    let resolveConfiguration!: () => void;
    queue.configureGlobalConcurrency.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveConfiguration = resolve;
      }),
    );

    const initialization = service.onModuleInit();
    expect(queue.configureGlobalConcurrency).toHaveBeenCalledTimes(1);
    expect(Worker).not.toHaveBeenCalled();

    resolveConfiguration();
    await initialization;

    expect(Worker).toHaveBeenCalledWith(
      ORDER_MATCHING_QUEUE_NAME,
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );
    await service.onApplicationShutdown();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it('does not start a consumer when configuring the shared limit fails', async () => {
    const failure = new Error('Redis unavailable');
    queue.configureGlobalConcurrency.mockRejectedValueOnce(failure);

    await expect(service.onModuleInit()).rejects.toBe(failure);
    expect(Worker).not.toHaveBeenCalled();
    await service.onApplicationShutdown();
    expect(worker.close).not.toHaveBeenCalled();
  });
});
