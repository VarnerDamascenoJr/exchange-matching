import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
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

@Injectable()
export class RealtimeOutboxDispatcherService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeOutboxDispatcherService.name);
  private dispatchPromise: Promise<void> | null = null;
  private pollTimer?: NodeJS.Timeout;
  private lastMaintenanceAt = 0;

  constructor(
    private readonly realtimeOutboxRepository: RealtimeOutboxRepository,
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
      const claimedRows = await this.realtimeOutboxRepository.claimNextBatch(
        this.createClaimToken(),
        REALTIME_OUTBOX_BATCH_SIZE,
        REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
      );

      if (claimedRows.length === 0) {
        return;
      }

      for (const row of claimedRows) {
        try {
          const event = this.normalizePayload(row.payload);
          await this.realtimePublisherService.publishEvent(event);
          await this.realtimeOutboxRepository.markAsPublished(
            row.id,
            row.claim_token,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown dispatch error';

          this.logger.error(
            `Failed to dispatch realtime event ${row.id}: ${message}`,
            error instanceof Error ? error.stack : undefined,
          );

          await this.realtimeOutboxRepository.releaseClaim(
            row.id,
            row.claim_token,
            message,
            REALTIME_OUTBOX_MAX_ATTEMPTS,
          );
        }
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
    const now = Date.now();
    const publishedCutoff = new Date(
      now - REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    const deadLetterCutoff = new Date(
      now - REALTIME_OUTBOX_DEAD_LETTER_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );

    await this.realtimeOutboxRepository.pruneExpiredEvents(
      publishedCutoff,
      deadLetterCutoff,
    );
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
