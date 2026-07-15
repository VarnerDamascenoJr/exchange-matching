import { Job } from 'bullmq';
import { MatchingService } from '../matching/matching.service';
import { OrderMatchingProcessor } from './order-matching.processor';

describe('OrderMatchingProcessor', () => {
  let processor: OrderMatchingProcessor;
  let matchingService: jest.Mocked<MatchingService>;

  beforeEach(() => {
    matchingService = {
      processOrder: jest.fn(),
    } as unknown as jest.Mocked<MatchingService>;

    processor = new OrderMatchingProcessor(matchingService);
  });

  it('should delegate queued jobs to the matching service', async () => {
    await expect(
      processor.process({
        name: 'process-order',
        data: {
          orderId: 'order-1',
        },
      } as Job<{ orderId: string }>),
    ).resolves.toBeUndefined();

    expect(matchingService.processOrder.mock.calls).toEqual([['order-1']]);
  });
});
