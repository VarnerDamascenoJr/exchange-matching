import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimePublisherService } from './realtime.publisher';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';

describe('RealtimeOutboxDispatcherService', () => {
  let dispatcher: RealtimeOutboxDispatcherService;
  let prismaService: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    realtimeEventOutbox: {
      deleteMany: jest.Mock;
    };
  };
  let realtimePublisherService: {
    publishEvent: jest.Mock;
  };

  beforeEach(() => {
    prismaService = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      realtimeEventOutbox: {
        deleteMany: jest.fn(),
      },
    };
    realtimePublisherService = {
      publishEvent: jest.fn(),
    };

    dispatcher = new RealtimeOutboxDispatcherService(
      prismaService as unknown as PrismaService,
      {
        get: jest.fn(),
      } as unknown as ConfigService,
      realtimePublisherService as unknown as RealtimePublisherService,
    );
  });

  it('does not claim events that were sent to the dead-letter queue', async () => {
    prismaService.$queryRaw.mockResolvedValueOnce([]);

    await dispatcher.dispatchPending();

    const query = prismaService.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.strings.join('')).toContain('"dead_lettered_at" IS NULL');
  });

  it('moves repeated dispatch failures toward the dead-letter queue', async () => {
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'event-1',
          claim_token: 'claim-1',
          payload: {
            type: 'market.changed',
            reason: 'order-opened',
            occurredAt: '2026-07-17T15:00:00.000Z',
          },
        },
      ])
      .mockResolvedValueOnce([]);
    realtimePublisherService.publishEvent.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );

    await dispatcher.dispatchPending();

    const releaseQuery = prismaService.$executeRaw.mock
      .calls[0][0] as Prisma.Sql;
    expect(releaseQuery.strings.join('')).toContain('"attempt_count" + 1 >=');
    expect(releaseQuery.strings.join('')).toContain('"dead_lettered_at"');
  });

  it('prunes published and dead-lettered events after their retention windows', async () => {
    await dispatcher.pruneExpiredEvents();

    expect(prismaService.realtimeEventOutbox.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { publishedAt: { lte: expect.any(Date) } },
          { deadLetteredAt: { lte: expect.any(Date) } },
        ],
      },
    });
  });
});
