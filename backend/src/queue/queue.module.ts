import { Module } from '@nestjs/common';
import { OrderMatchingQueueService } from './order-matching.queue';

@Module({
  providers: [OrderMatchingQueueService],
  exports: [OrderMatchingQueueService],
})
export class QueueModule {}
