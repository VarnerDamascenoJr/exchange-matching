import { Job } from 'bullmq';
import { MatchingService } from '../matching/matching.service';
import { OrderMatchingProcessor } from './order-matching.processor';

describe('OrderMatchingProcessor', () => {
  let processor: OrderMatchingProcessor;
  let matchingService: jest.Mocked<MatchingService>;

  beforeEach(() => {
    matchingService = {
      processOrder: jest.fn(),
      rejectOrderAfterFailedProcessing: jest.fn(),
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

  it('should preserve the retry when a non-final attempt fails', async () => {
    const processingError = new Error('temporary database error');
    matchingService.processOrder.mockRejectedValueOnce(processingError);

    await expect(
      processor.process({
        name: 'process-order',
        data: { orderId: 'order-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as Job<{ orderId: string }>),
    ).rejects.toThrow(processingError);

    expect(
      matchingService.rejectOrderAfterFailedProcessing,
    ).not.toHaveBeenCalled();
  });

  it('should reject and refund an order after its final failed attempt', async () => {
    matchingService.processOrder.mockRejectedValueOnce(
      new Error('persistent database error'),
    );

    await expect(
      processor.process({
        name: 'process-order',
        data: { orderId: 'order-1' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as Job<{ orderId: string }>),
    ).resolves.toBeUndefined();

    expect(matchingService.rejectOrderAfterFailedProcessing.mock.calls).toEqual(
      [['order-1']],
    );
  });
});
