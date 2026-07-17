import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderMatchingQueueService } from './order-matching.queue';
import { OrderMatchingOutboxDispatcherService } from './order-matching-outbox-dispatcher.service';

describe('OrderMatchingOutboxDispatcherService', () => {
  let dispatcher: OrderMatchingOutboxDispatcherService;
  let prismaService: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let orderMatchingQueueService: {
    enqueueProcessOrder: jest.Mock;
  };

  beforeEach(() => {
    prismaService = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };
    orderMatchingQueueService = {
      enqueueProcessOrder: jest.fn(),
    };

    dispatcher = new OrderMatchingOutboxDispatcherService(
      prismaService as unknown as PrismaService,
      {
        get: jest.fn(),
      } as unknown as ConfigService,
      orderMatchingQueueService as unknown as OrderMatchingQueueService,
    );
  });

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
});
