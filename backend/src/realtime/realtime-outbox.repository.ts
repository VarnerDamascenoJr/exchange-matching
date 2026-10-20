import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeDispatchEvent } from './realtime.types';

export type ClaimedRealtimeOutboxRow = {
  id: string;
  claim_token: string;
  payload: RealtimeDispatchEvent | string;
};

export type RealtimeOutboxEntry = {
  id: string;
  eventType: RealtimeDispatchEvent['type'];
  payload: string;
};

@Injectable()
export class RealtimeOutboxRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async insertEvents(
    entries: RealtimeOutboxEntry[],
    transactionClient: Prisma.TransactionClient = this.prismaService,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const rows = entries.map(
      (entry) => Prisma.sql`(
      ${entry.id},
      ${entry.eventType},
      CAST(${entry.payload} AS JSONB)
    )`,
    );

    await transactionClient.$executeRaw(Prisma.sql`
      INSERT INTO "realtime_event_outbox" (
        "id",
        "event_type",
        "payload"
      )
      VALUES ${Prisma.join(rows)}
    `);
  }

  async claimNextBatch(
    claimToken: string,
    batchSize: number,
    claimTimeoutSeconds: number,
  ): Promise<ClaimedRealtimeOutboxRow[]> {
    return this.prismaService.$queryRaw<ClaimedRealtimeOutboxRow[]>(Prisma.sql`
      WITH claimable AS (
        SELECT "id"
        FROM "realtime_event_outbox"
        WHERE "published_at" IS NULL
          AND "dead_lettered_at" IS NULL
          AND (
            "claimed_at" IS NULL
            OR "claimed_at" < NOW() - (${claimTimeoutSeconds} * INTERVAL '1 second')
          )
        ORDER BY "created_at" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "realtime_event_outbox" AS outbox
      SET
        "claimed_at" = NOW(),
        "claim_token" = ${claimToken}
      FROM claimable
      WHERE outbox."id" = claimable."id"
      RETURNING outbox."id", outbox."claim_token", outbox."payload"
    `);
  }

  async markAsPublished(id: string, claimToken: string): Promise<void> {
    await this.prismaService.$executeRaw(Prisma.sql`
      UPDATE "realtime_event_outbox"
      SET
        "published_at" = NOW(),
        "claimed_at" = NULL,
        "claim_token" = NULL,
        "last_error" = NULL
      WHERE "id" = ${id}
        AND "claim_token" = ${claimToken}
    `);
  }

  async releaseClaim(
    id: string,
    claimToken: string,
    lastError: string,
    maxAttempts: number,
  ): Promise<void> {
    await this.prismaService.$executeRaw(Prisma.sql`
      UPDATE "realtime_event_outbox"
      SET
        "attempt_count" = "attempt_count" + 1,
        "claimed_at" = NULL,
        "claim_token" = NULL,
        "last_error" = ${lastError},
        "dead_lettered_at" = CASE
          WHEN "attempt_count" + 1 >= ${maxAttempts}
            THEN NOW()
          ELSE NULL
        END
      WHERE "id" = ${id}
        AND "claim_token" = ${claimToken}
    `);
  }

  async pruneExpiredEvents(
    publishedCutoff: Date,
    deadLetterCutoff: Date,
  ): Promise<void> {
    await this.prismaService.realtimeEventOutbox.deleteMany({
      where: {
        OR: [
          { publishedAt: { lte: publishedCutoff } },
          { deadLetteredAt: { lte: deadLetterCutoff } },
        ],
      },
    });
  }
}
