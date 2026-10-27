import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ORDER_MATCHING_OUTBOX_BATCH_SIZE,
  ORDER_MATCHING_OUTBOX_CLAIM_TIMEOUT_SECONDS,
  ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS,
  ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS,
} from './order-matching.constants';
import { OrderMatchingQueueService } from './order-matching.queue';

type ClaimedOrderMatchingOutboxRow = {
  id: string;
  order_id: string;
  claim_token: string;
};

@Injectable()
export class OrderMatchingOutboxDispatcherService
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(
    OrderMatchingOutboxDispatcherService.name,
  );
  private dispatchPromise: Promise<void> | null = null;
  private pollTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly orderMatchingQueueService: OrderMatchingQueueService,
  ) {}

  onModuleInit() {
    if (this.stopping || !this.shouldRunDispatcher()) {
      return;
    }

    this.dispatchInBackground();
    this.pollTimer = setInterval(() => {
      this.dispatchInBackground();
    }, ORDER_MATCHING_OUTBOX_POLL_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    await this.dispatchPromise?.catch((error: unknown) => {
      this.logFailure(
        'Failed to finish matching outbox dispatch at shutdown',
        error,
      );
    });
  }

  onModuleDestroy() {
    return this.onApplicationShutdown();
  }

  private dispatchInBackground(): void {
    if (this.dispatchPromise || this.stopping) {
      return;
    }
    void this.dispatchPending().catch((error: unknown) => {
      if (!this.stopping) {
        this.logFailure('Order matching outbox dispatch failed', error);
      }
    });
  }

  async dispatchPending(): Promise<void> {
    if (this.stopping) {
      return;
    }
    if (this.dispatchPromise) {
      return this.dispatchPromise;
    }

    this.dispatchPromise = this.dispatchLoop().finally(() => {
      this.dispatchPromise = null;
    });

    return this.dispatchPromise;
  }

  private async dispatchLoop(): Promise<void> {
    while (!this.stopping) {
      const claimedRows = await this.claimNextBatch();

      if (claimedRows.length === 0) {
        return;
      }

      let hasFailedDispatch = false;

      for (const row of claimedRows) {
        try {
          await this.orderMatchingQueueService.enqueueProcessOrder(
            row.order_id,
          );
          await this.removeClaimedRow(row.id, row.claim_token);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown queue error';

          this.logger.error(
            `Failed to enqueue matching job for order ${row.order_id}: ${message}`,
            error instanceof Error ? error.stack : undefined,
          );
          hasFailedDispatch = true;
          try {
            await this.releaseClaim(row.id, row.claim_token, message);
          } catch (releaseError) {
            this.logFailure(
              `Failed to release matching claim ${row.id}; its lease must expire before retry`,
              releaseError,
            );
          }
        }
      }

      // Let the polling interval back off after a queue outage instead of
      // immediately reclaiming the same durable intent in a tight loop.
      if (hasFailedDispatch) {
        return;
      }
    }
  }

  private async claimNextBatch(): Promise<ClaimedOrderMatchingOutboxRow[]> {
    const claimToken = this.createClaimToken();
    const claimTimeoutInterval = Prisma.raw(
      `INTERVAL '${ORDER_MATCHING_OUTBOX_CLAIM_TIMEOUT_SECONDS} seconds'`,
    );

    return this.prismaService.$queryRaw<
      ClaimedOrderMatchingOutboxRow[]
    >(Prisma.sql`
      WITH claimable AS (
        SELECT "id"
        FROM "order_matching_outbox"
        WHERE ("claimed_at" IS NULL
          OR "claimed_at" < NOW() - ${claimTimeoutInterval})
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
        ORDER BY "created_at" ASC
        LIMIT ${ORDER_MATCHING_OUTBOX_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "order_matching_outbox" AS outbox
      SET
        "claimed_at" = NOW(),
        "claim_token" = ${claimToken}
      FROM claimable
      WHERE outbox."id" = claimable."id"
      RETURNING outbox."id", outbox."order_id", outbox."claim_token"
    `);
  }

  private async removeClaimedRow(
    id: string,
    claimToken: string,
  ): Promise<void> {
    await this.prismaService.$executeRaw(Prisma.sql`
      DELETE FROM "order_matching_outbox"
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
      UPDATE "order_matching_outbox"
      SET
        "attempt_count" = "attempt_count" + 1,
        "claimed_at" = NULL,
        "claim_token" = NULL,
        "next_attempt_at" = NOW() + (${ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS} * INTERVAL '1 millisecond'),
        "last_error" = ${lastError}
      WHERE "id" = ${id}
        AND "claim_token" = ${claimToken}
    `);
  }

  private shouldRunDispatcher(): boolean {
    return (
      this.configService.get<string>('NODE_ENV') !== 'test' ||
      this.configService.get<boolean>('RUN_DATABASE_E2E') === true
    );
  }

  private logFailure(context: string, error: unknown): void {
    this.logger.error(
      `${context}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private createClaimToken(): string {
    return `claim_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
