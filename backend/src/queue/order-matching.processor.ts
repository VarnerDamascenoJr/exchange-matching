import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MatchingService } from '../matching/matching.service';
import { ProcessOrderJobData } from './order-matching.types';

@Injectable()
export class OrderMatchingProcessor {
  private readonly logger = new Logger(OrderMatchingProcessor.name);

  constructor(private readonly matchingService: MatchingService) {}

  async process(job: Job<ProcessOrderJobData>): Promise<void> {
    await this.matchingService.processOrder(job.data.orderId);
    this.logger.log(`Processed ${job.name} job for order ${job.data.orderId}`);
  }
}
