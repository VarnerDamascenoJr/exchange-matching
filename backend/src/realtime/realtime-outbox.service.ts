import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RealtimeOutboxEntry,
  RealtimeOutboxRepository,
} from './realtime-outbox.repository';
import { RealtimeDispatchEvent } from './realtime.types';

@Injectable()
export class RealtimeOutboxService {
  constructor(
    private readonly realtimeOutboxRepository: RealtimeOutboxRepository,
  ) {}

  async appendEvent(
    transactionClient: Prisma.TransactionClient,
    event: RealtimeDispatchEvent,
  ): Promise<void> {
    await this.appendEvents(transactionClient, [event]);
  }

  async appendEvents(
    transactionClient: Prisma.TransactionClient,
    events: RealtimeDispatchEvent[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.realtimeOutboxRepository.insertEvents(
      this.buildEntries(events),
      transactionClient,
    );
  }

  async appendNow(events: RealtimeDispatchEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.realtimeOutboxRepository.insertEvents(this.buildEntries(events));
  }

  private buildEntries(events: RealtimeDispatchEvent[]): RealtimeOutboxEntry[] {
    return events.map((event) => ({
      id: this.createOutboxId(),
      eventType: event.type,
      payload: JSON.stringify(event),
    }));
  }

  private createOutboxId(): string {
    return `evt_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
