import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  REALTIME_OUTBOX_BATCH_SIZE,
  REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
  REALTIME_OUTBOX_DEAD_LETTER_RETENTION_DAYS,
  REALTIME_OUTBOX_MAINTENANCE_INTERVAL_MS,
  REALTIME_OUTBOX_MAX_ATTEMPTS,
  REALTIME_OUTBOX_POLL_INTERVAL_MS,
  REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS,
} from './realtime.constants';
import { RealtimePublisherService } from './realtime.publisher';
import { RealtimeDispatchEvent } from './realtime.types';

type ClaimedRealtimeOutboxRow = {
  id: string;
  claim_token: string;
  payload: RealtimeDispatchEvent | string;
};

@Injectable()
export class RealtimeOutboxDispatcherService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeOutboxDispatcherService.name);
  private dispatchPromise: Promise<void> | null = null;
  private pollTimer?: NodeJS.Timeout;
  private lastMaintenanceAt = 0;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly realtimePublisherService: RealtimePublisherService,
  ) {}

  onModuleInit() {
    if (!this.shouldRunRealtime()) {
      return;
    }

    void this.dispatchPending();
    void this.runMaintenanceIfDue();
    this.pollTimer = setInterval(() => {
      void this.dispatchPending();
      void this.runMaintenanceIfDue();
    }, REALTIME_OUTBOX_POLL_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    await this.dispatchPromise;
  }

  async dispatchPending(): Promise<void> {
    if (this.dispatchPromise) {
      return this.dispatchPromise;
    }

    this.dispatchPromise = this.dispatchLoop().finally(() => {
      this.dispatchPromise = null;
    });

    return this.dispatchPromise;
  }

  private async dispatchLoop(): Promise<void> {
    while (true) {
      const claimedRows = await this.claimNextBatch();

      if (claimedRows.length === 0) {
        return;
      }

      for (const row of claimedRows) {
        try {
          const event = this.normalizePayload(row.payload);
          await this.realtimePublisherService.publishEvent(event);
          await this.markAsPublished(row.id, row.claim_token);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown dispatch error';

          this.logger.error(
            `Failed to dispatch realtime event ${row.id}: ${message}`,
            error instanceof Error ? error.stack : undefined,
          );

          await this.releaseClaim(row.id, row.claim_token, message);
        }
      }
    }
  }

  private async claimNextBatch(): Promise<ClaimedRealtimeOutboxRow[]> {
    const claimToken = this.createClaimToken();
    const claimTimeoutInterval = Prisma.raw(
      `INTERVAL '${REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS} seconds'`,
    );

    return this.prismaService.$queryRaw<ClaimedRealtimeOutboxRow[]>(Prisma.sql`
      WITH claimable AS (
        SELECT "id"
        FROM "realtime_event_outbox"
        WHERE "published_at" IS NULL
          AND "dead_lettered_at" IS NULL
          AND (
            "claimed_at" IS NULL
            OR "claimed_at" < NOW() - ${claimTimeoutInterval}
          )
        ORDER BY "created_at" ASC
        LIMIT ${REALTIME_OUTBOX_BATCH_SIZE}
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

  private async markAsPublished(id: string, claimToken: string): Promise<void> {
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

  private async releaseClaim(
    id: string,
    claimToken: string,
    lastError: string,
  ): Promise<void> {
    await this.prismaService.$executeRaw(Prisma.sql`
      UPDATE "realtime_event_outbox"
      SET
        "attempt_count" = "attempt_count" + 1,
        "claimed_at" = NULL,
        "claim_token" = NULL,
        "last_error" = ${lastError},
        "dead_lettered_at" = CASE
          WHEN "attempt_count" + 1 >= ${REALTIME_OUTBOX_MAX_ATTEMPTS}
            THEN NOW()
          ELSE NULL
        END
      WHERE "id" = ${id}
        AND "claim_token" = ${claimToken}
    `);
  }

  private normalizePayload(
    payload: RealtimeDispatchEvent | string,
  ): RealtimeDispatchEvent {
    return typeof payload === 'string'
      ? (JSON.parse(payload) as RealtimeDispatchEvent)
      : payload;
  }

  async pruneExpiredEvents(): Promise<void> {
    const now = Date.now();
    const publishedCutoff = new Date(
      now - REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    const deadLetterCutoff = new Date(
      now - REALTIME_OUTBOX_DEAD_LETTER_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );

    await this.prismaService.realtimeEventOutbox.deleteMany({
      where: {
        OR: [
          { publishedAt: { lte: publishedCutoff } },
          { deadLetteredAt: { lte: deadLetterCutoff } },
        ],
      },
    });
  }

  private async runMaintenanceIfDue(): Promise<void> {
    const now = Date.now();

    if (
      now - this.lastMaintenanceAt <
      REALTIME_OUTBOX_MAINTENANCE_INTERVAL_MS
    ) {
      return;
    }

    this.lastMaintenanceAt = now;

    try {
      await this.pruneExpiredEvents();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown maintenance error';
      this.logger.error(`Failed to prune realtime outbox events: ${message}`);
    }
  }

  private shouldRunRealtime(): boolean {
    return (
      this.configService.get<string>('NODE_ENV') !== 'test' ||
      this.configService.get<boolean>('RUN_DATABASE_E2E') === true
    );
  }

  private createClaimToken(): string {
    return `claim_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
