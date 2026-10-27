import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderMatchingQueueService } from './order-matching.queue';
import { OrderMatchingOutboxDispatcherService } from './order-matching-outbox-dispatcher.service';
import {
  ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS,
  ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS,
} from './order-matching.constants';

describe('OrderMatchingOutboxDispatcherService', () => {
  let dispatcher: OrderMatchingOutboxDispatcherService;
  let prismaService: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let orderMatchingQueueService: {
    enqueueProcessOrder: jest.Mock;
  };
  let config: { get: jest.Mock };
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    prismaService = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn(),
    };
    orderMatchingQueueService = {
      enqueueProcessOrder: jest.fn(),
    };

    config = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : false)),
    };
    dispatcher = new OrderMatchingOutboxDispatcherService(
      prismaService as unknown as PrismaService,
      config as unknown as ConfigService,
      orderMatchingQueueService as unknown as OrderMatchingQueueService,
    );
  });

  afterEach(async () => {
    await dispatcher.onApplicationShutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('claims only pending or expired claims with row locking', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([]);

    await dispatcher.dispatchPending();

    const query = prismaService.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const sql = query.strings.join('');
    expect(sql).toContain('"order_matching_outbox"');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('"claimed_at" IS NULL');
    expect(sql).toContain('"next_attempt_at" <= NOW()');
  });

  it('removes an intent only after BullMQ accepts its job', async () => {
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'outbox-1',
          order_id: 'order-1',
          claim_token: 'claim-1',
        },
      ])
      .mockResolvedValueOnce([]);

    await dispatcher.dispatchPending();

    expect(orderMatchingQueueService.enqueueProcessOrder).toHaveBeenCalledWith(
      'order-1',
    );
    const deleteQuery = prismaService.$executeRaw.mock
      .calls[0][0] as Prisma.Sql;
    expect(deleteQuery.strings.join('')).toContain(
      'DELETE FROM "order_matching_outbox"',
    );
  });

  it('releases an intent for retry when BullMQ is unavailable', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([
      {
        id: 'outbox-1',
        order_id: 'order-1',
        claim_token: 'claim-1',
      },
    ]);
    orderMatchingQueueService.enqueueProcessOrder.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );

    await dispatcher.dispatchPending();

    const releaseQuery = prismaService.$executeRaw.mock
      .calls[0][0] as Prisma.Sql;
    const sql = releaseQuery.strings.join('');
    expect(sql).toContain('"attempt_count" = "attempt_count" + 1');
    expect(sql).toContain('"claimed_at" = NULL');
    expect(sql).toContain('"last_error"');
    expect(sql).toContain('"next_attempt_at" = NOW()');
    expect(releaseQuery.values).toContain(ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('honors the durable retry interval across polling and immediate callers', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T18:00:00Z'));
    config.get.mockReturnValue('development');
    let nextAttemptAt = 0;
    prismaService.$queryRaw.mockImplementation(() =>
      Promise.resolve(
        Date.now() >= nextAttemptAt
          ? [{ id: 'outbox-1', order_id: 'order-1', claim_token: 'claim-1' }]
          : [],
      ),
    );
    prismaService.$executeRaw.mockImplementation((sql: Prisma.Sql) => {
      nextAttemptAt = sql.strings.join('').includes('DELETE')
        ? Infinity
        : Date.now() + ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS;
      return Promise.resolve(1);
    });
    orderMatchingQueueService.enqueueProcessOrder.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );
    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    await dispatcher.dispatchPending();
    await dispatcher.dispatchPending();
    await jest.advanceTimersByTimeAsync(
      ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS - 1,
    );
    expect(orderMatchingQueueService.enqueueProcessOrder).toHaveBeenCalledTimes(
      1,
    );
    await jest.advanceTimersByTimeAsync(1);
    expect(orderMatchingQueueService.enqueueProcessOrder).toHaveBeenCalledTimes(
      2,
    );
    expect(prismaService.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('catches claim failures during startup and polling and recovers on the next tick', async () => {
    jest.useFakeTimers();
    config.get.mockReturnValue('development');
    prismaService.$queryRaw
      .mockRejectedValueOnce(new Error('Startup database failure'))
      .mockRejectedValueOnce(new Error('Polling database failure'));
    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Startup database failure'),
      expect.any(String),
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Polling database failure'),
      expect.any(String),
    );
  });

  it('handles removal and release failures while still dispatching other claimed intents', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([
      { id: 'outbox-1', order_id: 'order-1', claim_token: 'claim-1' },
      { id: 'outbox-2', order_id: 'order-2', claim_token: 'claim-1' },
    ]);
    prismaService.$executeRaw
      .mockRejectedValueOnce(new Error('Removal failed'))
      .mockRejectedValueOnce(new Error('Release failed'));
    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();
    expect(orderMatchingQueueService.enqueueProcessOrder.mock.calls).toEqual([
      ['order-1'],
      ['order-2'],
    ]);
    expect(prismaService.$executeRaw).toHaveBeenCalledTimes(3);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Failed to release matching claim outbox-1'),
      expect.any(String),
    );
  });

  it('shares concurrent dispatches and clears state after a claim failure', async () => {
    let rejectClaim!: (error: Error) => void;
    prismaService.$queryRaw.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectClaim = reject;
      }),
    );
    const first = dispatcher.dispatchPending();
    const second = dispatcher.dispatchPending();
    const failure = new Error('Database unavailable');
    const results = Promise.allSettled([first, second]);
    rejectClaim(failure);
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    await dispatcher.dispatchPending();
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('drains a claimed batch before module destruction and does not start another one', async () => {
    jest.useFakeTimers();
    config.get.mockReturnValue('development');
    let resolveClaim!: (
      rows: { id: string; order_id: string; claim_token: string }[],
    ) => void;
    prismaService.$queryRaw.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve;
      }),
    );
    dispatcher.onModuleInit();
    const dispatch = dispatcher.dispatchPending();
    let stopped = false;
    const shutdown = dispatcher.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    const waitedForDispatch = !stopped;
    resolveClaim([
      { id: 'outbox-1', order_id: 'order-1', claim_token: 'claim-1' },
      { id: 'outbox-2', order_id: 'order-2', claim_token: 'claim-1' },
    ]);
    await Promise.all([dispatch, shutdown]);
    await jest.advanceTimersByTimeAsync(ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);
    await dispatcher.dispatchPending();
    dispatcher.onModuleInit();
    expect(waitedForDispatch).toBe(true);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    expect(orderMatchingQueueService.enqueueProcessOrder).toHaveBeenCalledTimes(
      2,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles an in-flight failure during shutdown without rejecting the shutdown hook', async () => {
    let rejectClaim!: (error: Error) => void;
    prismaService.$queryRaw.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectClaim = reject;
      }),
    );
    const dispatch = dispatcher.dispatchPending().catch(() => {});
    const shutdown = dispatcher.onApplicationShutdown();
    rejectClaim(new Error('Database stopped during dispatch'));
    await Promise.all([dispatch, shutdown]);
    await dispatcher.dispatchPending();
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to finish matching outbox dispatch at shutdown',
      ),
      expect.any(String),
    );
  });

  it('does not start polling in ordinary unit tests', () => {
    dispatcher.onModuleInit();
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });
  function enablePolling() {
    jest.useFakeTimers();
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'development' : false,
    );
    return errorLog;
  }

  const pendingRow = {
    id: 'outbox-1',
    order_id: 'order-1',
    claim_token: 'claim-1',
  };

  it.each(['startup', 'poll'] as const)(
    'logs a %s claim failure and dispatches again on the next poll',
    async (phase) => {
      const loggedError = enablePolling();
      const failure = new Error('Database unavailable');
      if (phase === 'poll') {
        prismaService.$queryRaw.mockResolvedValueOnce([]);
      }
      prismaService.$queryRaw
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce([pendingRow]);

      dispatcher.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      if (phase === 'poll') {
        await jest.advanceTimersByTimeAsync(
          ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS,
        );
      }

      expect(loggedError).toHaveBeenCalledTimes(1);
      expect(loggedError).toHaveBeenCalledWith(
        'Order matching outbox dispatch failed: Database unavailable',
        failure.stack,
      );
      expect(
        orderMatchingQueueService.enqueueProcessOrder,
      ).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(
        ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS,
      );

      expect(
        orderMatchingQueueService.enqueueProcessOrder,
      ).toHaveBeenCalledWith(pendingRow.order_id);
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(1);
      expect(loggedError).toHaveBeenCalledTimes(1);
    },
  );

  it('contains a failed claim release and resumes dispatching other pending orders', async () => {
    const loggedError = enablePolling();
    const failure = new Error('Database unavailable during claim release');
    prismaService.$queryRaw
      .mockResolvedValueOnce([pendingRow])
      .mockResolvedValueOnce([
        { ...pendingRow, id: 'outbox-2', order_id: 'order-2' },
      ]);
    orderMatchingQueueService.enqueueProcessOrder.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );
    prismaService.$executeRaw.mockRejectedValueOnce(failure);

    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    expect(loggedError).toHaveBeenCalledWith(
      'Failed to release matching claim outbox-1; its lease must expire before retry: Database unavailable during claim release',
      failure.stack,
    );

    await jest.advanceTimersByTimeAsync(ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);

    expect(
      orderMatchingQueueService.enqueueProcessOrder,
    ).toHaveBeenNthCalledWith(2, 'order-2');
    expect(prismaService.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('does not overlap slow dispatches or log the same failure on every tick', async () => {
    const loggedError = enablePolling();
    const failure = new Error('Slow database request failed');
    let rejectClaim!: (error: Error) => void;
    prismaService.$queryRaw.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectClaim = reject;
      }),
    );

    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(
      ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS * 2,
    );
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);

    rejectClaim(failure);
    await jest.advanceTimersByTimeAsync(0);
    expect(loggedError).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
    expect(loggedError).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight failure during shutdown and stops polling', async () => {
    const loggedError = enablePolling();
    let rejectClaim!: (error: Error) => void;
    prismaService.$queryRaw.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectClaim = reject;
      }),
    );

    dispatcher.onModuleInit();
    const shutdown = dispatcher.onApplicationShutdown();
    rejectClaim(new Error('Database unavailable during shutdown'));

    await expect(shutdown).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);
    expect(loggedError).toHaveBeenCalledTimes(1);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('preserves direct dispatch errors and allows callers to retry', async () => {
    const failure = new Error('Database unavailable');
    prismaService.$queryRaw.mockRejectedValueOnce(failure);

    await expect(dispatcher.dispatchPending()).rejects.toBe(failure);
    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
