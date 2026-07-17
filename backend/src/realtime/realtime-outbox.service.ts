import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeDispatchEvent } from './realtime.types';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class RealtimeOutboxService {
  constructor(private readonly prismaService: PrismaService) {}

  async appendEvent(
    transactionClient: TransactionClient,
    event: RealtimeDispatchEvent,
  ): Promise<void> {
    await this.appendEvents(transactionClient, [event]);
  }

  async appendEvents(
    transactionClient: TransactionClient,
    events: RealtimeDispatchEvent[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const rows = events.map((event) => {
      const eventId = this.createOutboxId();
      const payload = JSON.stringify(event);

      return Prisma.sql`(
        ${eventId},
        ${event.type},
        CAST(${payload} AS JSONB)
      )`;
    });

    await transactionClient.$executeRaw(Prisma.sql`
      INSERT INTO "realtime_event_outbox" (
        "id",
        "event_type",
        "payload"
      )
      VALUES ${Prisma.join(rows)}
    `);
  }

  async appendNow(events: RealtimeDispatchEvent[]): Promise<void> {
    await this.appendEvents(this.prismaService, events);
  }

  private createOutboxId(): string {
    return `evt_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
