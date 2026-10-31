import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
import {
  REALTIME_OUTBOX_BATCH_SIZE,
  REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
  REALTIME_OUTBOX_DEAD_LETTER_RETENTION_DAYS,
  REALTIME_OUTBOX_MAINTENANCE_INTERVAL_MS,
  REALTIME_OUTBOX_MAX_ATTEMPTS,
  REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
  REALTIME_OUTBOX_POLL_INTERVAL_MS,
  REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS,
  REALTIME_OUTBOX_RETRY_DELAY_MS,
} from './realtime.constants';
import { RealtimePublisherService } from './realtime.publisher';
import { RealtimeDispatchEvent } from './realtime.types';

@Injectable()
export class RealtimeOutboxDispatcherService
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeOutboxDispatcherService.name);
  private dispatchPromise: Promise<void> | null = null;
  private maintenancePromise: Promise<void> | null = null;
  private pollTimer?: NodeJS.Timeout;
  private lastMaintenanceAt: number | null = null;
  private stopping = false;

  constructor(
    private readonly realtimeOutboxRepository: RealtimeOutboxRepository,
    private readonly configService: ConfigService,
    private readonly realtimePublisherService: RealtimePublisherService,
  ) {}

  onModuleInit() {
    if (this.stopping || !this.shouldRunRealtime()) {
      return;
    }

    this.dispatchInBackground();
    void this.runMaintenanceIfDue();
    this.pollTimer = setInterval(() => {
      this.dispatchInBackground();
      void this.runMaintenanceIfDue();
    }, REALTIME_OUTBOX_POLL_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    await Promise.all([
      this.dispatchPromise?.catch((error: unknown) =>
        this.logFailure(
          'Failed to finish realtime dispatch at shutdown',
          error,
        ),
      ),
      this.maintenancePromise?.catch((error: unknown) =>
        this.logFailure(
          'Failed to finish realtime maintenance at shutdown',
          error,
        ),
      ),
    ]);
  }

  // Drain while Prisma and the Redis publisher are still available.
  onModuleDestroy() {
    return this.onApplicationShutdown();
  }

  private dispatchInBackground(): void {
    if (this.dispatchPromise || this.stopping) {
      return;
    }
    void this.dispatchPending().catch((error: unknown) => {
      if (!this.stopping) {
        this.logFailure('Realtime outbox dispatch failed', error);
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
      const claimedRows = await this.realtimeOutboxRepository.claimNextBatch(
        this.createClaimToken(),
        REALTIME_OUTBOX_BATCH_SIZE,
        REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
      );

      if (claimedRows.length === 0) {
        return;
      }

      let hasFailedDispatch = false;
      for (const row of claimedRows) {
        try {
          const event = this.normalizePayload(row.payload);
          await this.realtimePublisherService.publishEvent(event);
          await this.realtimeOutboxRepository.markAsPublished(
            row.id,
            row.claim_token,
          );
        } catch (error) {
          hasFailedDispatch = true;
          const message =
            error instanceof Error ? error.message : 'Unknown dispatch error';

          this.logger.error(
            `Failed to dispatch realtime event ${row.id}: ${message}`,
            error instanceof Error ? error.stack : undefined,
          );

          try {
            await this.realtimeOutboxRepository.releaseClaim(
              row.id,
              row.claim_token,
              message,
              REALTIME_OUTBOX_MAX_ATTEMPTS,
              REALTIME_OUTBOX_RETRY_DELAY_MS,
              REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
            );
          } catch (releaseError) {
            this.logFailure(
              `Failed to release realtime claim ${row.id}; its lease must expire before retry`,
              releaseError,
            );
          }
        }
      }
      if (hasFailedDispatch) {
        return;
      }
    }
  }

  private normalizePayload(
    payload: RealtimeDispatchEvent | string,
  ): RealtimeDispatchEvent {
    return typeof payload === 'string'
      ? (JSON.parse(payload) as RealtimeDispatchEvent)
      : payload;
  }

  async pruneExpiredEvents(): Promise<void> {
    if (this.stopping) {
      return;
    }
    if (this.maintenancePromise) {
      return this.maintenancePromise;
    }
    const now = Date.now();
    const publishedCutoff = new Date(
      now - REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    const deadLetterCutoff = new Date(
      now - REALTIME_OUTBOX_DEAD_LETTER_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );

    this.maintenancePromise = this.realtimeOutboxRepository
      .pruneExpiredEvents(publishedCutoff, deadLetterCutoff)
      .finally(() => {
        this.maintenancePromise = null;
      });
    return this.maintenancePromise;
  }

  private async runMaintenanceIfDue(): Promise<void> {
    if (this.stopping || this.maintenancePromise) {
      return;
    }
    const now = Date.now();

    if (
      this.lastMaintenanceAt !== null &&
      now - this.lastMaintenanceAt < REALTIME_OUTBOX_MAINTENANCE_INTERVAL_MS
    ) {
      return;
    }

    this.lastMaintenanceAt = now;

    try {
      await this.pruneExpiredEvents();
    } catch (error) {
      this.lastMaintenanceAt = null;
      this.logFailure('Failed to prune realtime outbox events', error);
    }
  }

  private logFailure(context: string, error: unknown): void {
    this.logger.error(
      `${context}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error.stack : undefined,
    );
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
