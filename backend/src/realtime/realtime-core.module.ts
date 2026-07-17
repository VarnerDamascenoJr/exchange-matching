import { Module } from '@nestjs/common';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from './realtime-outbox.service';
import { RealtimePublisherService } from './realtime.publisher';

@Module({
  providers: [
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
