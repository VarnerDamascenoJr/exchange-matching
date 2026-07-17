import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MatchingService } from '../matching/matching.service';
import { ProcessOrderJobData } from './order-matching.types';

@Injectable()
export class OrderMatchingProcessor {
  private readonly logger = new Logger(OrderMatchingProcessor.name);

  constructor(private readonly matchingService: MatchingService) {}

  async process(job: Job<ProcessOrderJobData>): Promise<void> {
    try {
      await this.matchingService.processOrder(job.data.orderId);
      this.logger.log(
        `Processed ${job.name} job for order ${job.data.orderId}`,
      );
    } catch (error) {
      if (!this.isFinalAttempt(job)) {
        throw error;
      }

      await this.matchingService.rejectOrderAfterFailedProcessing(
        job.data.orderId,
      );
      this.logger.error(
        `Rejected order ${job.data.orderId} after ${job.opts.attempts ?? 1} failed matching attempts`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private isFinalAttempt(job: Job<ProcessOrderJobData>): boolean {
    const maximumAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= maximumAttempts;
  }
}
