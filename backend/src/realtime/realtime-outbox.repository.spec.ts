import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';

describe('RealtimeOutboxRepository', () => {
  let repository: RealtimeOutboxRepository;
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    realtimeEventOutbox: { deleteMany: jest.Mock };
  };
  let transaction: { $executeRaw: jest.Mock };
  let transactionClient: Prisma.TransactionClient;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      realtimeEventOutbox: { deleteMany: jest.fn() },
    };
    transaction = { $executeRaw: jest.fn() };
    transactionClient = transaction as unknown as Prisma.TransactionClient;
    repository = new RealtimeOutboxRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('should store all events in one parameterized insert inside the supplied transaction', async () => {
    const payload = JSON.stringify({
      type: 'market.changed',
      reason: "owner's order",
      occurredAt: '2026-10-15T18:00:00Z',
    });
    const entries = [
      { id: 'event-1', eventType: 'market.changed' as const, payload },
      {
        id: 'event-2',
        eventType: 'account.changed' as const,
        payload: '{"userId":"user-1"}',
      },
    ];
    await repository.insertEvents(entries, transactionClient);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = transaction.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.strings.join('')).toContain(
      'INSERT INTO "realtime_event_outbox"',
    );
    expect(sql.strings.join('')).toContain('AS JSONB');
    expect(sql.strings.join('')).not.toContain(payload);
    expect(sql.values).toEqual([
      'event-1',
      'market.changed',
      payload,
      'event-2',
      'account.changed',
      entries[1].payload,
    ]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('should support immediate inserts through the root client', async () => {
    await repository.insertEvents([
      { id: 'event-1', eventType: 'market.changed', payload: '{}' },
    ]);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('should skip database access for empty inserts', async () => {
    await repository.insertEvents([]);
    await repository.insertEvents([], transactionClient);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('should atomically claim unpublished, live or expired-lease events using SKIP LOCKED', async () => {
    const rows = [{ id: 'event-1', claim_token: 'claim-1', payload: '{}' }];
    prisma.$queryRaw.mockResolvedValueOnce(rows);
    await expect(repository.claimNextBatch('claim-1', 50, 30)).resolves.toBe(
      rows,
    );
    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const query = sql.strings.join('');
    expect(query).toContain('"published_at" IS NULL');
    expect(query).toContain('"dead_lettered_at" IS NULL');
    expect(query).toContain('"next_attempt_at" <= NOW()');
    expect(query).toContain('"claimed_at" IS NULL');
    expect(query).toContain('ORDER BY "created_at" ASC');
    expect(query).toContain('FOR UPDATE SKIP LOCKED');
    expect(query).toContain('UPDATE "realtime_event_outbox" AS outbox');
    expect(query).toContain("INTERVAL '1 second'");
    expect(sql.values).toEqual([30, 50, 'claim-1']);
  });

  it('should mark published events only when the claim token still matches', async () => {
    await repository.markAsPublished('event-1', 'claim-1');
    const sql = prisma.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.strings.join('')).toContain('"published_at" = NOW()');
    expect(sql.strings.join('')).toContain('"claim_token" = NULL');
    expect(sql.strings.join('')).toContain('"last_error" = NULL');
    expect(sql.strings.join('')).toContain('"next_attempt_at" = NULL');
    expect(sql.strings.join('')).toContain('AND "claim_token" =');
    expect(sql.values).toEqual(['event-1', 'claim-1']);
  });

  it('should release only the owned claim, increment attempts and apply the supplied dead-letter threshold', async () => {
    await repository.releaseClaim(
      'event-1',
      'claim-1',
      'Redis unavailable',
      10,
      2000,
      60000,
    );
    const sql = prisma.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    const query = sql.strings.join('');
    expect(query).toContain('"attempt_count" = "attempt_count" + 1');
    expect(query).toContain('"attempt_count" + 1 >=');
    expect(query).toContain('"dead_lettered_at" = CASE');
    expect(query).toContain('"next_attempt_at" = CASE');
    expect(query).toContain("INTERVAL '1 millisecond'");
    expect(query).toContain('AND "claim_token" =');
    expect(sql.values).toEqual([
      'Redis unavailable',
      10,
      2000,
      60000,
      10,
      'event-1',
      'claim-1',
    ]);
  });

  it('should prune only published and dead-lettered rows at the supplied cutoffs', async () => {
    const publishedCutoff = new Date('2026-10-08T18:00:00Z');
    const deadLetterCutoff = new Date('2026-09-15T18:00:00Z');
    await repository.pruneExpiredEvents(publishedCutoff, deadLetterCutoff);
    expect(prisma.realtimeEventOutbox.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { publishedAt: { lte: publishedCutoff } },
          { deadLetteredAt: { lte: deadLetterCutoff } },
        ],
      },
    });
  });

  it('should propagate insert failures so the enclosing order transaction rolls back', async () => {
    const failure = new Error('Insert failed');
    transaction.$executeRaw.mockRejectedValueOnce(failure);
    await expect(
      repository.insertEvents(
        [{ id: 'event-1', eventType: 'market.changed', payload: '{}' }],
        transactionClient,
      ),
    ).rejects.toBe(failure);
  });
});
