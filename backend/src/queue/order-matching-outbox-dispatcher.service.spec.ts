import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderMatchingQueueService } from './order-matching.queue';
import { OrderMatchingOutboxDispatcherService } from './order-matching-outbox-dispatcher.service';
import { ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS } from './order-matching.constants';

const pendingRow = {
  id: 'outbox-1',
  order_id: 'order-1',
  claim_token: 'claim-1',
};

describe('OrderMatchingOutboxDispatcherService', () => {
  let dispatcher: OrderMatchingOutboxDispatcherService;
  let config: { get: jest.Mock };
  let prismaService: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let orderMatchingQueueService: {
    enqueueProcessOrder: jest.Mock;
  };

  beforeEach(() => {
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

  function enablePolling() {
    jest.useFakeTimers();
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'development' : false,
    );
    return jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  }

  it('claims only pending or expired claims with row locking', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([]);

    await dispatcher.dispatchPending();

    const query = prismaService.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const sql = query.strings.join('');
    expect(sql).toContain('"order_matching_outbox"');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('"claimed_at" IS NULL');
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
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
  });

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
      'Order matching outbox dispatch failed: Database unavailable during claim release',
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
