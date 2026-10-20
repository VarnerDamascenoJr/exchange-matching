import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from './realtime-outbox.service';
import { RealtimePublisherService } from './realtime.publisher';

@Module({
  imports: [PrismaModule],
  providers: [
    RealtimeOutboxRepository,
    RealtimePublisherService,
    RealtimeOutboxService,
    RealtimeOutboxDispatcherService,
  ],
  exports: [
    RealtimePublisherService,
    RealtimeOutboxService,
    RealtimeOutboxDispatcherService,
  ],
})
export class RealtimeCoreModule {}
