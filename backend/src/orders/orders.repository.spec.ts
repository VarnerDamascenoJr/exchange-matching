import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from './orders.repository';

describe('OrdersRepository', () => {
  let repository: OrdersRepository;
  let prisma: {
    $transaction: jest.Mock;
    order: { count: jest.Mock; findMany: jest.Mock };
  };
  let transaction: {
    $queryRaw: jest.Mock;
    wallet: { findUnique: jest.Mock };
    order: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let transactionClient: Prisma.TransactionClient;

  beforeEach(() => {
    transaction = {
      $queryRaw: jest.fn(),
      wallet: { findUnique: jest.fn() },
      order: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    transactionClient = transaction as unknown as Prisma.TransactionClient;
    prisma = {
      $transaction: jest.fn(
        <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) =>
          operation(transactionClient),
      ),
      order: { count: jest.fn(), findMany: jest.fn() },
    };
    repository = new OrdersRepository(prisma as unknown as PrismaService);
  });

  it('should pass the transaction client to the operation and return its result', async () => {
    const operation = jest.fn().mockResolvedValue('result');
    await expect(repository.runInTransaction(operation)).resolves.toBe(
      'result',
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(operation);
    expect(operation).toHaveBeenCalledWith(transactionClient);
  });

  it('should propagate transaction failures to the caller', async () => {
    const failure = new Error('Outbox write failed');
    await expect(
      repository.runInTransaction(() => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  it('should find the wallet by owner within the supplied transaction', async () => {
    const wallet = { id: 'wallet-1', userId: 'user-1' };
    transaction.wallet.findUnique.mockResolvedValueOnce(wallet);
    await expect(
      repository.findWalletByUserId(transactionClient, 'user-1'),
    ).resolves.toBe(wallet);
    expect(transaction.wallet.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('should return null when the user has no wallet', async () => {
    transaction.wallet.findUnique.mockResolvedValueOnce(null);
    await expect(
      repository.findWalletByUserId(transactionClient, 'missing-user'),
    ).resolves.toBeNull();
  });

  it.each([OrderSide.BUY, OrderSide.SELL])(
    'should create a QUEUED %s order with its full amount remaining',
    async (side) => {
      const order = { id: 'order-1' };
      const amount = new Prisma.Decimal('0.12345678');
      const price = new Prisma.Decimal('10000.12345678');
      transaction.order.create.mockResolvedValueOnce(order);
      await expect(
        repository.createOrder(transactionClient, {
          userId: 'user-1',
          side,
          amount,
          price,
        }),
      ).resolves.toBe(order);
      expect(transaction.order.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          side,
          status: OrderStatus.QUEUED,
          price,
          originalAmount: amount,
          remainingAmount: amount,
        },
      });
    },
  );

  it.each([
    [undefined, {}],
    ['   ', {}],
    [' order ', { id: { startsWith: 'order' } }],
  ])(
    'should scope both active queries to the owner and the same ID filter (%s)',
    async (id, filter) => {
      const orders = [{ id: 'order-1' }];
      prisma.order.count.mockResolvedValueOnce(6);
      prisma.order.findMany.mockResolvedValueOnce(orders);
      await expect(
        repository.findActiveOrders('user-1', { page: 2, pageSize: 5, id }),
      ).resolves.toEqual({ orders, totalItems: 6 });
      const where = {
        userId: 'user-1',
        status: {
          in: [
            OrderStatus.QUEUED,
            OrderStatus.OPEN,
            OrderStatus.PARTIALLY_FILLED,
          ],
        },
        ...filter,
      };
      expect(prisma.order.count).toHaveBeenCalledWith({ where });
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        skip: 5,
        take: 5,
      });
    },
  );

  it('should return an empty page and zero total for a user without active orders', async () => {
    prisma.order.count.mockResolvedValueOnce(0);
    prisma.order.findMany.mockResolvedValueOnce([]);
    await expect(
      repository.findActiveOrders('user-1', { page: 1, pageSize: 25 }),
    ).resolves.toEqual({ orders: [], totalItems: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 25 }),
    );
  });

  it('should cancel the order in the supplied transaction and return persisted values', async () => {
    const cancelledOrder = {
      id: 'order-1',
      status: OrderStatus.CANCELLED,
      updatedAt: new Date('2026-10-15T18:00:00Z'),
    };
    transaction.order.update.mockResolvedValueOnce(cancelledOrder);
    await expect(
      repository.cancelOrder(transactionClient, 'order-1'),
    ).resolves.toBe(cancelledOrder);
    expect(transaction.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: OrderStatus.CANCELLED },
    });
  });

  it('should lock an owned order with parameterized SQL before loading it', async () => {
    const order = { id: 'order-1', userId: 'user-1' };
    transaction.$queryRaw.mockResolvedValueOnce([{ id: order.id }]);
    transaction.order.findFirst.mockImplementationOnce(() => {
      expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
      return Promise.resolve(order);
    });
    await expect(
      repository.lockAndLoadOrder(transactionClient, order.id, order.userId),
    ).resolves.toBe(order);
    const [sql, ...parameters] = transaction.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...string[],
    ];
    expect(sql.join('?')).toContain('WHERE "id" = ?');
    expect(sql.join('?')).toContain('AND "user_id" = ?');
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(parameters).toEqual(['order-1', 'user-1']);
    expect(transaction.order.findFirst).toHaveBeenCalledWith({
      where: { id: order.id, userId: order.userId },
    });
    expect(transaction.order.findUnique).not.toHaveBeenCalled();
  });

  it('should lock and load an order without owner filtering for the matching worker', async () => {
    const order = { id: 'order-1' };
    transaction.$queryRaw.mockResolvedValueOnce([{ id: order.id }]);
    transaction.order.findUnique.mockResolvedValueOnce(order);
    await expect(
      repository.lockAndLoadOrder(transactionClient, order.id),
    ).resolves.toBe(order);
    const [sql, ...parameters] = transaction.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...string[],
    ];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(sql.join('?')).not.toContain('user_id');
    expect(parameters).toEqual(['order-1']);
    expect(transaction.order.findUnique).toHaveBeenCalledWith({
      where: { id: order.id },
    });
    expect(transaction.order.findFirst).not.toHaveBeenCalled();
  });

  it.each([undefined, 'different-user'])(
    'should not load an order when no row is locked (owner: %s)',
    async (userId) => {
      transaction.$queryRaw.mockResolvedValueOnce([]);
      await expect(
        repository.lockAndLoadOrder(transactionClient, 'order-1', userId),
      ).resolves.toBeNull();
      expect(transaction.order.findFirst).not.toHaveBeenCalled();
      expect(transaction.order.findUnique).not.toHaveBeenCalled();
    },
  );

  it('should propagate lock errors without reading an unlocked order', async () => {
    const failure = new Error('Deadlock detected');
    transaction.$queryRaw.mockRejectedValueOnce(failure);
    await expect(
      repository.lockAndLoadOrder(transactionClient, 'order-1'),
    ).rejects.toBe(failure);
    expect(transaction.order.findUnique).not.toHaveBeenCalled();
  });
});
