import { PrismaService } from '../prisma/prisma.service';
import { OrderMatchingOutboxService } from './order-matching-outbox.service';

describe('OrderMatchingOutboxService', () => {
  it('stores one durable matching intent in the active transaction', async () => {
    const transactionClient = {
      orderMatchingOutbox: {
        create: jest.fn(),
      },
    };
    const service = new OrderMatchingOutboxService();

    await service.appendOrder(
      transactionClient as unknown as PrismaService,
      'order-1',
    );

    expect(transactionClient.orderMatchingOutbox.create).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^match_/),
        orderId: 'order-1',
      },
    });
  });
});
