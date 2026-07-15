import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderMatchingQueueService } from '../queue/order-matching.queue';
import { OrdersService } from './orders.service';

const buildWallet = (overrides?: {
  availableBtc?: string;
  reservedBtc?: string;
  availableUsd?: string;
  reservedUsd?: string;
}) => ({
  id: 'wallet-1',
  userId: 'user-1',
  availableBtc: new Prisma.Decimal(overrides?.availableBtc ?? '100'),
  reservedBtc: new Prisma.Decimal(overrides?.reservedBtc ?? '0'),
  availableUsd: new Prisma.Decimal(overrides?.availableUsd ?? '100000'),
  reservedUsd: new Prisma.Decimal(overrides?.reservedUsd ?? '0'),
  createdAt: new Date('2026-07-14T15:25:00.000Z'),
  updatedAt: new Date('2026-07-14T15:25:00.000Z'),
});

const buildOrder = (overrides?: {
  id?: string;
  sequence?: bigint;
  userId?: string;
  side?: OrderSide;
  status?: OrderStatus;
  price?: string;
  originalAmount?: string;
  remainingAmount?: string;
}) => ({
  id: overrides?.id ?? 'order-1',
  sequence: overrides?.sequence ?? BigInt(1),
  userId: overrides?.userId ?? 'user-1',
  side: overrides?.side ?? OrderSide.BUY,
  status: overrides?.status ?? OrderStatus.QUEUED,
  price: new Prisma.Decimal(overrides?.price ?? '10000'),
  originalAmount: new Prisma.Decimal(overrides?.originalAmount ?? '0.5'),
  remainingAmount: new Prisma.Decimal(overrides?.remainingAmount ?? '0.5'),
  createdAt: new Date('2026-07-14T15:30:00.000Z'),
  updatedAt: new Date('2026-07-14T15:30:00.000Z'),
});

describe('OrdersService', () => {
  let ordersService: OrdersService;
  let prismaService: jest.Mocked<PrismaService>;
  let orderMatchingQueueService: jest.Mocked<OrderMatchingQueueService>;
  let rootOrderFindManyMock: jest.Mock;
  let transactionClient: {
    $queryRaw: jest.Mock;
    wallet: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    order: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(() => {
    rootOrderFindManyMock = jest.fn();

    transactionClient = {
      $queryRaw: jest.fn(),
      wallet: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      order: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    prismaService = {
      order: {
        findMany: rootOrderFindManyMock,
      },
      $transaction: jest.fn(
        <T>(
          callback: (client: typeof transactionClient) => Promise<T> | T,
        ): Promise<T> => Promise.resolve(callback(transactionClient)),
      ),
    } as unknown as jest.Mocked<PrismaService>;

    orderMatchingQueueService = {
      enqueueProcessOrder: jest.fn(),
    } as unknown as jest.Mocked<OrderMatchingQueueService>;

    ordersService = new OrdersService(prismaService, orderMatchingQueueService);
  });

  it('should create a valid BUY order and reserve USD', async () => {
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
    transactionClient.order.create.mockResolvedValueOnce(buildOrder());

    const order = await ordersService.createOrder(
      'user-1',
      OrderSide.BUY,
      '0.5',
      '10000',
    );

    expect(transactionClient.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        availableUsd: {
          gte: new Prisma.Decimal('5000'),
        },
      },
      data: {
        availableUsd: {
          decrement: new Prisma.Decimal('5000'),
        },
        reservedUsd: {
          increment: new Prisma.Decimal('5000'),
        },
      },
    });
    expect(order).toEqual({
      id: 'order-1',
      side: OrderSide.BUY,
      status: OrderStatus.QUEUED,
      price: '10000.00000000',
      originalAmount: '0.50000000',
      remainingAmount: '0.50000000',
      createdAt: '2026-07-14T15:30:00.000Z',
      updatedAt: '2026-07-14T15:30:00.000Z',
    });
    expect(orderMatchingQueueService.enqueueProcessOrder.mock.calls).toEqual([
      ['order-1'],
    ]);
  });

  it('should create a valid SELL order and reserve BTC', async () => {
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
    transactionClient.order.create.mockResolvedValueOnce({
      ...buildOrder(),
      side: OrderSide.SELL,
    });

    const order = await ordersService.createOrder(
      'user-1',
      OrderSide.SELL,
      '0.75',
      '12000',
    );

    expect(transactionClient.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        availableBtc: {
          gte: new Prisma.Decimal('0.75'),
        },
      },
      data: {
        availableBtc: {
          decrement: new Prisma.Decimal('0.75'),
        },
        reservedBtc: {
          increment: new Prisma.Decimal('0.75'),
        },
      },
    });
    expect(order.side).toBe(OrderSide.SELL);
    expect(orderMatchingQueueService.enqueueProcessOrder.mock.calls).toEqual([
      ['order-1'],
    ]);
  });

  it('should reserve BUY funds using values already quantized to 8 decimal places', async () => {
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
    transactionClient.order.create.mockResolvedValueOnce(
      buildOrder({
        price: '0.33333333',
        originalAmount: '0.1',
        remainingAmount: '0.1',
      }),
    );

    await ordersService.createOrder(
      'user-1',
      OrderSide.BUY,
      '0.1',
      '0.33333333',
    );

    expect(transactionClient.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        availableUsd: {
          gte: new Prisma.Decimal('0.03333333'),
        },
      },
      data: {
        availableUsd: {
          decrement: new Prisma.Decimal('0.03333333'),
        },
        reservedUsd: {
          increment: new Prisma.Decimal('0.03333333'),
        },
      },
    });
  });

  it('should reject BUY orders with insufficient USD balance', async () => {
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.wallet.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      ordersService.createOrder('user-1', OrderSide.BUY, '20', '10000'),
    ).rejects.toThrow(new BadRequestException('Insufficient USD balance'));
  });

  it('should reject SELL orders with insufficient BTC balance', async () => {
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.wallet.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      ordersService.createOrder('user-1', OrderSide.SELL, '200', '10000'),
    ).rejects.toThrow(new BadRequestException('Insufficient BTC balance'));
  });

  it('should reject invalid amount values', async () => {
    await expect(
      ordersService.createOrder('user-1', OrderSide.BUY, 'abc', '10000'),
    ).rejects.toThrow(
      new BadRequestException('amount must be a valid decimal'),
    );
  });

  it('should reject amount values with more than 8 decimal places', async () => {
    await expect(
      ordersService.createOrder(
        'user-1',
        OrderSide.BUY,
        '0.123456789',
        '10000',
      ),
    ).rejects.toThrow(
      new BadRequestException('amount must have at most 8 decimal places'),
    );
  });

  it('should reject invalid price values', async () => {
    await expect(
      ordersService.createOrder('user-1', OrderSide.BUY, '1', '0'),
    ).rejects.toThrow(
      new BadRequestException('price must be greater than zero'),
    );
  });

  it('should reject price values that exceed DECIMAL(28,8) precision', async () => {
    await expect(
      ordersService.createOrder(
        'user-1',
        OrderSide.BUY,
        '1',
        '12345678901234567890123456789',
      ),
    ).rejects.toThrow(
      new BadRequestException('price must fit within DECIMAL(28,8)'),
    );
  });

  it('should fail when the authenticated user has no wallet', async () => {
    transactionClient.wallet.findUnique.mockResolvedValueOnce(null);

    await expect(
      ordersService.createOrder('user-1', OrderSide.BUY, '1', '10000'),
    ).rejects.toThrow(new NotFoundException('Wallet not found'));
    expect(
      orderMatchingQueueService.enqueueProcessOrder.mock.calls,
    ).toHaveLength(0);
  });

  it('should reject the order and refund funds when queue publishing fails', async () => {
    transactionClient.wallet.findUnique
      .mockResolvedValueOnce(buildWallet())
      .mockResolvedValueOnce(buildWallet());
    transactionClient.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
    transactionClient.order.create.mockResolvedValueOnce(buildOrder());
    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: 'order-1' }]);
    transactionClient.order.findUnique.mockResolvedValueOnce(buildOrder());
    transactionClient.order.update.mockResolvedValueOnce({
      ...buildOrder(),
      status: OrderStatus.REJECTED,
    });
    transactionClient.wallet.update.mockResolvedValueOnce(buildWallet());
    orderMatchingQueueService.enqueueProcessOrder.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );

    await expect(
      ordersService.createOrder('user-1', OrderSide.BUY, '0.5', '10000'),
    ).rejects.toThrow(
      new ServiceUnavailableException(
        'Order could not be queued for processing',
      ),
    );

    expect(transactionClient.order.update).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
      },
      data: {
        status: OrderStatus.REJECTED,
      },
    });
    expect(transactionClient.wallet.update).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
      data: {
        availableUsd: {
          increment: new Prisma.Decimal('5000'),
        },
        reservedUsd: {
          decrement: new Prisma.Decimal('5000'),
        },
      },
    });
  });

  it('should list only active orders for the authenticated user', async () => {
    rootOrderFindManyMock.mockResolvedValueOnce([
      buildOrder(),
      {
        ...buildOrder(),
        id: 'order-2',
        sequence: BigInt(2),
        status: OrderStatus.OPEN,
      },
    ]);

    const orders = await ordersService.getActiveOrders('user-1');

    expect(rootOrderFindManyMock.mock.calls).toEqual([
      [
        {
          where: {
            userId: 'user-1',
            status: {
              in: [
                OrderStatus.QUEUED,
                OrderStatus.OPEN,
                OrderStatus.PARTIALLY_FILLED,
              ],
            },
          },
          orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        },
      ],
    ]);
    expect(orders).toHaveLength(2);
  });

  it('should cancel a BUY order and release reserved USD', async () => {
    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: 'order-1' }]);
    transactionClient.order.findFirst.mockResolvedValueOnce(buildOrder());
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.order.update.mockResolvedValueOnce({
      ...buildOrder(),
      status: OrderStatus.CANCELLED,
    });
    transactionClient.wallet.update.mockResolvedValueOnce(buildWallet());

    const order = await ordersService.cancelOrder('user-1', 'order-1');

    expect(transactionClient.order.update).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
      },
      data: {
        status: OrderStatus.CANCELLED,
      },
    });
    expect(transactionClient.wallet.update).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
      data: {
        availableUsd: {
          increment: new Prisma.Decimal('5000'),
        },
        reservedUsd: {
          decrement: new Prisma.Decimal('5000'),
        },
      },
    });
    expect(order.status).toBe(OrderStatus.CANCELLED);
  });

  it('should cancel a SELL order and release reserved BTC', async () => {
    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: 'order-1' }]);
    transactionClient.order.findFirst.mockResolvedValueOnce({
      ...buildOrder({
        side: OrderSide.SELL,
        remainingAmount: '0.75',
      }),
      side: OrderSide.SELL,
      remainingAmount: new Prisma.Decimal('0.75'),
    });
    transactionClient.wallet.findUnique.mockResolvedValueOnce(buildWallet());
    transactionClient.order.update.mockResolvedValueOnce({
      ...buildOrder({
        side: OrderSide.SELL,
        status: OrderStatus.CANCELLED,
        remainingAmount: '0.75',
      }),
      side: OrderSide.SELL,
      status: OrderStatus.CANCELLED,
      remainingAmount: new Prisma.Decimal('0.75'),
    });
    transactionClient.wallet.update.mockResolvedValueOnce(buildWallet());

    await ordersService.cancelOrder('user-1', 'order-1');

    expect(transactionClient.wallet.update).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
      data: {
        availableBtc: {
          increment: new Prisma.Decimal('0.75'),
        },
        reservedBtc: {
          decrement: new Prisma.Decimal('0.75'),
        },
      },
    });
  });

  it('should reject cancellation for another user order', async () => {
    transactionClient.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      ordersService.cancelOrder('user-1', 'order-1'),
    ).rejects.toThrow(new NotFoundException('Order not found'));
  });

  it('should reject repeated cancellation without releasing funds again', async () => {
    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: 'order-1' }]);
    transactionClient.order.findFirst.mockResolvedValueOnce({
      ...buildOrder({
        status: OrderStatus.CANCELLED,
      }),
      status: OrderStatus.CANCELLED,
    });

    await expect(
      ordersService.cancelOrder('user-1', 'order-1'),
    ).rejects.toThrow(new BadRequestException('Order cannot be cancelled'));
    expect(transactionClient.wallet.update).not.toHaveBeenCalled();
  });
});
