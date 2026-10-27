import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { OUTBOX_REDIS_TIMEOUT_MS } from '../common/outbox-redis-options';
import {
  ORDER_MATCHING_QUEUE_NAME,
  PROCESS_ORDER_JOB_NAME,
} from './order-matching.constants';
import { OrderMatchingQueueService } from './order-matching.queue';

jest.mock('bullmq', () => ({ Queue: jest.fn() }));

describe('OrderMatchingQueueService', () => {
  let service: OrderMatchingQueueService;
  let queue: {
    add: jest.Mock;
    close: jest.Mock;
    disconnect: jest.Mock;
    on: jest.Mock;
  };
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'order-1' }),
      close: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };
    jest.mocked(Queue).mockImplementation(() => queue as unknown as Queue);
    service = new OrderMatchingQueueService({
      getOrThrow: jest.fn((key: string) =>
        key === 'REDIS_HOST' ? 'localhost' : 6379,
      ),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lazily reuses a producer connection with bounded Redis operations and stable job IDs', async () => {
    expect(Queue).not.toHaveBeenCalled();
    await service.enqueueProcessOrder('order-1');
    await service.enqueueProcessOrder('order-2');
    expect(Queue).toHaveBeenCalledTimes(1);
    expect(Queue).toHaveBeenCalledWith(ORDER_MATCHING_QUEUE_NAME, {
      connection: {
        host: 'localhost',
        port: 6379,
        connectTimeout: OUTBOX_REDIS_TIMEOUT_MS,
        commandTimeout: OUTBOX_REDIS_TIMEOUT_MS,
        maxRetriesPerRequest: 0,
        retryStrategy: expect.any(Function),
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      PROCESS_ORDER_JOB_NAME,
      { orderId: 'order-1' },
      {
        jobId: 'order-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('recreates a failed producer on the next outbox attempt', async () => {
    const failure = new Error('Redis unavailable');
    queue.add.mockRejectedValueOnce(failure);
    await expect(service.enqueueProcessOrder('order-1')).rejects.toBe(failure);
    expect(queue.close).toHaveBeenCalledTimes(1);
    await service.enqueueProcessOrder('order-1');
    expect(Queue).toHaveBeenCalledTimes(2);
  });

  it('preserves the dispatch error if graceful close also fails', async () => {
    const failure = new Error('Redis unavailable');
    queue.add.mockRejectedValueOnce(failure);
    queue.close.mockRejectedValueOnce(new Error('Close failed'));
    await expect(service.enqueueProcessOrder('order-1')).rejects.toBe(failure);
    expect(queue.disconnect).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to close matching queue gracefully',
      expect.any(String),
    );
  });

  it('handles forced disconnection errors without abandoning the original dispatch error', async () => {
    const failure = new Error('Redis unavailable');
    queue.add.mockRejectedValueOnce(failure);
    queue.close.mockRejectedValueOnce(new Error('Close failed'));
    queue.disconnect.mockRejectedValueOnce(new Error('Disconnect failed'));
    await expect(service.enqueueProcessOrder('order-1')).rejects.toBe(failure);
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to disconnect matching queue',
      expect.any(String),
    );
  });

  it('closes an initialized producer only once at shutdown', async () => {
    await service.enqueueProcessOrder('order-1');
    await service.onApplicationShutdown();
    await service.onApplicationShutdown();
    expect(queue.close).toHaveBeenCalledTimes(1);
  });

  it('does not create a connection solely to shut down', async () => {
    await service.onApplicationShutdown();
    expect(Queue).not.toHaveBeenCalled();
  });
});
