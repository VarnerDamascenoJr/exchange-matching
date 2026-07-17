import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderMatchingOutboxDispatcherService } from './order-matching-outbox-dispatcher.service';
import { OrderMatchingOutboxService } from './order-matching-outbox.service';
import { OrderMatchingQueueService } from './order-matching.queue';

@Module({
  imports: [PrismaModule],
  providers: [
    OrderMatchingQueueService,
    OrderMatchingOutboxService,
    OrderMatchingOutboxDispatcherService,
  ],
  exports: [
    OrderMatchingQueueService,
    OrderMatchingOutboxService,
    OrderMatchingOutboxDispatcherService,
  ],
})
export class QueueModule {}
