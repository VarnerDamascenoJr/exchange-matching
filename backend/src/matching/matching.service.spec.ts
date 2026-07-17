import { NotFoundException } from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma, TradeFeeAsset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeOutboxDispatcherService } from '../realtime/realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { OrderLockingService } from '../orders/order-locking.service';
import { MatchingOrderBookService } from './matching-order-book.service';
import { MatchingService } from './matching.service';
import { TradeSettlementService } from './trade-settlement.service';
import { WalletFundsService } from '../wallets/wallet-funds.service';

const buildOrder = (overrides?: {
  id?: string;
  userId?: string;
  side?: OrderSide;
  status?: OrderStatus;
  price?: string;
  originalAmount?: string;
  remainingAmount?: string;
  sequence?: bigint;
}) => ({
  id: overrides?.id ?? 'order-1',
  sequence: overrides?.sequence ?? BigInt(1),
  userId: overrides?.userId ?? 'user-1',
  side: overrides?.side ?? OrderSide.BUY,
  status: overrides?.status ?? OrderStatus.QUEUED,
  price: new Prisma.Decimal(overrides?.price ?? '10000'),
  originalAmount: new Prisma.Decimal(overrides?.originalAmount ?? '1'),
  remainingAmount: new Prisma.Decimal(overrides?.remainingAmount ?? '1'),
  createdAt: new Date('2026-07-15T11:00:00.000Z'),
  updatedAt: new Date('2026-07-15T11:00:00.000Z'),
});

const buildWallet = (overrides?: {
  id?: string;
  userId?: string;
  availableBtc?: string;
  reservedBtc?: string;
  availableUsd?: string;
  reservedUsd?: string;
}) => ({
  id: overrides?.id ?? `wallet-${overrides?.userId ?? 'user-1'}`,
  userId: overrides?.userId ?? 'user-1',
  availableBtc: new Prisma.Decimal(overrides?.availableBtc ?? '0'),
  reservedBtc: new Prisma.Decimal(overrides?.reservedBtc ?? '0'),
  availableUsd: new Prisma.Decimal(overrides?.availableUsd ?? '0'),
  reservedUsd: new Prisma.Decimal(overrides?.reservedUsd ?? '0'),
  createdAt: new Date('2026-07-15T11:00:00.000Z'),
  updatedAt: new Date('2026-07-15T11:00:00.000Z'),
});

describe('MatchingService', () => {
  let matchingService: MatchingService;
  let prismaService: jest.Mocked<PrismaService>;
  let realtimeOutboxService: jest.Mocked<RealtimeOutboxService>;
  let realtimeOutboxDispatcherService: jest.Mocked<RealtimeOutboxDispatcherService>;
  let matchingOrderBookService: MatchingOrderBookService;
  let orderLockingService: OrderLockingService;
  let tradeSettlementService: TradeSettlementService;
  let walletFundsService: WalletFundsService;
  let transactionClient: {
    $queryRaw: jest.Mock;
    order: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    wallet: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    trade: {
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    transactionClient = {
      $queryRaw: jest.fn(),
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      wallet: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      trade: {
        create: jest.fn(),
      },
    };
    transactionClient.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);

    prismaService = {
      $transaction: jest.fn(
        <T>(
          callback: (client: typeof transactionClient) => Promise<T> | T,
        ): Promise<T> => Promise.resolve(callback(transactionClient)),
      ),
    } as unknown as jest.Mocked<PrismaService>;

    realtimeOutboxService = {
      appendEvent: jest.fn(),
      appendEvents: jest.fn(),
    } as unknown as jest.Mocked<RealtimeOutboxService>;

    realtimeOutboxDispatcherService = {
      dispatchPending: jest.fn(),
    } as unknown as jest.Mocked<RealtimeOutboxDispatcherService>;

    matchingOrderBookService = new MatchingOrderBookService();
    orderLockingService = new OrderLockingService();
    tradeSettlementService = new TradeSettlementService();
    walletFundsService = new WalletFundsService();

    matchingService = new MatchingService(
      prismaService,
      matchingOrderBookService,
      orderLockingService,
      tradeSettlementService,
      realtimeOutboxService,
      realtimeOutboxDispatcherService,
      walletFundsService,
    );
  });

  it('should move a queued order to OPEN when there is no compatible maker', async () => {
    transactionClient.order.findUnique.mockResolvedValueOnce(buildOrder());
    transactionClient.order.findMany.mockResolvedValueOnce([]);

    await expect(
      matchingService.processOrder('order-1'),
    ).resolves.toBeUndefined();

    expect(transactionClient.order.update.mock.calls).toEqual([
      [
        {
          where: {
            id: 'order-1',
          },
          data: {
            status: OrderStatus.OPEN,
          },
        },
      ],
    ]);
    expect(realtimeOutboxService.appendEvents).toHaveBeenCalledWith(
      transactionClient,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'market.changed',
          reason: 'order-opened',
          orderId: 'order-1',
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'order-opened',
          orderId: 'order-1',
          userId: 'user-1',
        }),
      ]),
    );
    expect(realtimeOutboxDispatcherService.dispatchPending).toHaveBeenCalled();
  });

  it('should fully match a BUY taker using maker price and refund price improvement', async () => {
    const taker = buildOrder({
      id: 'buy-taker',
      userId: 'buyer',
      side: OrderSide.BUY,
      status: OrderStatus.QUEUED,
      price: '10000',
      originalAmount: '1',
      remainingAmount: '1',
      sequence: BigInt(10),
    });
    const maker = buildOrder({
      id: 'sell-maker',
      userId: 'seller',
      side: OrderSide.SELL,
      status: OrderStatus.OPEN,
      price: '9000',
      originalAmount: '1',
      remainingAmount: '1',
      sequence: BigInt(5),
    });

    transactionClient.order.findUnique
      .mockResolvedValueOnce(taker)
      .mockResolvedValueOnce(maker);
    transactionClient.order.findMany.mockResolvedValueOnce([{ id: maker.id }]);
    transactionClient.$queryRaw
      .mockResolvedValueOnce([{ id: taker.id }])
      .mockResolvedValueOnce([{ id: maker.id }])
      .mockResolvedValueOnce([{ id: 'wallet-buyer' }, { id: 'wallet-seller' }]);
    transactionClient.wallet.findMany.mockResolvedValueOnce([
      buildWallet({
        id: 'wallet-buyer',
        userId: 'buyer',
        reservedUsd: '10000',
      }),
      buildWallet({
        id: 'wallet-seller',
        userId: 'seller',
        reservedBtc: '1',
      }),
    ]);
    transactionClient.trade.create.mockResolvedValueOnce({
      id: 'trade-1',
    });

    await matchingService.processOrder(taker.id);

    expect(transactionClient.wallet.update.mock.calls).toEqual([
      [
        {
          where: {
            userId: 'buyer',
          },
          data: {
            reservedUsd: {
              decrement: new Prisma.Decimal('10000'),
            },
            availableUsd: {
              increment: new Prisma.Decimal('1000'),
            },
            availableBtc: {
              increment: new Prisma.Decimal('0.997'),
            },
          },
        },
      ],
      [
        {
          where: {
            userId: 'seller',
          },
          data: {
            reservedBtc: {
              decrement: new Prisma.Decimal('1'),
            },
            availableUsd: {
              increment: new Prisma.Decimal('8955'),
            },
          },
        },
      ],
    ]);

    expect(transactionClient.trade.create.mock.calls).toEqual([
      [
        {
          data: {
            makerOrderId: 'sell-maker',
            takerOrderId: 'buy-taker',
            buyOrderId: 'buy-taker',
            sellOrderId: 'sell-maker',
            takerSide: OrderSide.BUY,
            makerFeeRate: new Prisma.Decimal('0.005'),
            makerFeeAmount: new Prisma.Decimal('45'),
            makerFeeAsset: TradeFeeAsset.USD,
            takerFeeRate: new Prisma.Decimal('0.003'),
            takerFeeAmount: new Prisma.Decimal('0.003'),
            takerFeeAsset: TradeFeeAsset.BTC,
            price: new Prisma.Decimal('9000'),
            amount: new Prisma.Decimal('1'),
          },
        },
      ],
    ]);

    expect(transactionClient.order.update.mock.calls).toEqual([
      [
        {
          where: {
            id: 'sell-maker',
          },
          data: {
            remainingAmount: new Prisma.Decimal('0'),
            status: OrderStatus.FILLED,
          },
        },
      ],
      [
        {
          where: {
            id: 'buy-taker',
          },
          data: {
            remainingAmount: new Prisma.Decimal('0'),
            status: OrderStatus.FILLED,
          },
        },
      ],
    ]);
    expect(realtimeOutboxService.appendEvents).toHaveBeenCalledWith(
      transactionClient,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'market.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1'],
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1'],
          userId: 'buyer',
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1'],
          userId: 'seller',
        }),
      ]),
    );
  });

  it('should partially fill a queued order across multiple makers in price-time priority', async () => {
    const taker = buildOrder({
      id: 'buy-taker',
      userId: 'buyer',
      side: OrderSide.BUY,
      status: OrderStatus.QUEUED,
      price: '10000',
      originalAmount: '1',
      remainingAmount: '1',
    });
    const makerOne = buildOrder({
      id: 'sell-maker-1',
      userId: 'seller-1',
      side: OrderSide.SELL,
      status: OrderStatus.OPEN,
      price: '9000',
      originalAmount: '0.4',
      remainingAmount: '0.4',
      sequence: BigInt(1),
    });
    const makerTwo = buildOrder({
      id: 'sell-maker-2',
      userId: 'seller-2',
      side: OrderSide.SELL,
      status: OrderStatus.OPEN,
      price: '9500',
      originalAmount: '0.3',
      remainingAmount: '0.3',
      sequence: BigInt(2),
    });

    transactionClient.order.findUnique
      .mockResolvedValueOnce(taker)
      .mockResolvedValueOnce(makerOne)
      .mockResolvedValueOnce(makerTwo);
    transactionClient.order.findMany.mockResolvedValueOnce([
      { id: makerOne.id },
      { id: makerTwo.id },
    ]);
    transactionClient.$queryRaw
      .mockResolvedValueOnce([{ id: taker.id }])
      .mockResolvedValueOnce([{ id: makerOne.id }])
      .mockResolvedValueOnce([{ id: makerTwo.id }])
      .mockResolvedValueOnce([
        { id: 'wallet-buyer' },
        { id: 'wallet-seller-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'wallet-buyer' },
        { id: 'wallet-seller-2' },
      ]);
    transactionClient.wallet.findMany
      .mockResolvedValueOnce([
        buildWallet({
          id: 'wallet-buyer',
          userId: 'buyer',
          reservedUsd: '10000',
        }),
        buildWallet({
          id: 'wallet-seller-1',
          userId: 'seller-1',
          reservedBtc: '0.4',
        }),
      ])
      .mockResolvedValueOnce([
        buildWallet({
          id: 'wallet-buyer',
          userId: 'buyer',
          reservedUsd: '6000',
        }),
        buildWallet({
          id: 'wallet-seller-2',
          userId: 'seller-2',
          reservedBtc: '0.3',
        }),
      ]);
    transactionClient.trade.create
      .mockResolvedValueOnce({
        id: 'trade-1',
      })
      .mockResolvedValueOnce({
        id: 'trade-2',
      });

    await matchingService.processOrder(taker.id);

    expect(transactionClient.trade.create.mock.calls).toHaveLength(2);
    expect(transactionClient.trade.create.mock.calls).toEqual([
      [
        {
          data: {
            makerOrderId: 'sell-maker-1',
            takerOrderId: 'buy-taker',
            buyOrderId: 'buy-taker',
            sellOrderId: 'sell-maker-1',
            takerSide: OrderSide.BUY,
            makerFeeRate: new Prisma.Decimal('0.005'),
            makerFeeAmount: new Prisma.Decimal('18'),
            makerFeeAsset: TradeFeeAsset.USD,
            takerFeeRate: new Prisma.Decimal('0.003'),
            takerFeeAmount: new Prisma.Decimal('0.0012'),
            takerFeeAsset: TradeFeeAsset.BTC,
            price: new Prisma.Decimal('9000'),
            amount: new Prisma.Decimal('0.4'),
          },
        },
      ],
      [
        {
          data: {
            makerOrderId: 'sell-maker-2',
            takerOrderId: 'buy-taker',
            buyOrderId: 'buy-taker',
            sellOrderId: 'sell-maker-2',
            takerSide: OrderSide.BUY,
            makerFeeRate: new Prisma.Decimal('0.005'),
            makerFeeAmount: new Prisma.Decimal('14.25'),
            makerFeeAsset: TradeFeeAsset.USD,
            takerFeeRate: new Prisma.Decimal('0.003'),
            takerFeeAmount: new Prisma.Decimal('0.0009'),
            takerFeeAsset: TradeFeeAsset.BTC,
            price: new Prisma.Decimal('9500'),
            amount: new Prisma.Decimal('0.3'),
          },
        },
      ],
    ]);

    expect(transactionClient.order.update.mock.calls).toEqual([
      [
        {
          where: {
            id: 'sell-maker-1',
          },
          data: {
            remainingAmount: new Prisma.Decimal('0'),
            status: OrderStatus.FILLED,
          },
        },
      ],
      [
        {
          where: {
            id: 'sell-maker-2',
          },
          data: {
            remainingAmount: new Prisma.Decimal('0'),
            status: OrderStatus.FILLED,
          },
        },
      ],
      [
        {
          where: {
            id: 'buy-taker',
          },
          data: {
            remainingAmount: new Prisma.Decimal('0.3'),
            status: OrderStatus.PARTIALLY_FILLED,
          },
        },
      ],
    ]);
    expect(realtimeOutboxService.appendEvents).toHaveBeenCalledWith(
      transactionClient,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'market.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1', 'trade-2'],
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1', 'trade-2'],
          userId: 'buyer',
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1', 'trade-2'],
          userId: 'seller-1',
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'buy-taker',
          tradeIds: ['trade-1', 'trade-2'],
          userId: 'seller-2',
        }),
      ]),
    );
  });

  it('should fully match a SELL taker against a BUY maker', async () => {
    const taker = buildOrder({
      id: 'sell-taker',
      userId: 'seller',
      side: OrderSide.SELL,
      status: OrderStatus.QUEUED,
      price: '9500',
      originalAmount: '1',
      remainingAmount: '1',
    });
    const maker = buildOrder({
      id: 'buy-maker',
      userId: 'buyer',
      side: OrderSide.BUY,
      status: OrderStatus.OPEN,
      price: '10000',
      originalAmount: '1',
      remainingAmount: '1',
    });

    transactionClient.order.findUnique
      .mockResolvedValueOnce(taker)
      .mockResolvedValueOnce(maker);
    transactionClient.order.findMany.mockResolvedValueOnce([{ id: maker.id }]);
    transactionClient.$queryRaw
      .mockResolvedValueOnce([{ id: taker.id }])
      .mockResolvedValueOnce([{ id: maker.id }])
      .mockResolvedValueOnce([{ id: 'wallet-seller' }, { id: 'wallet-buyer' }]);
    transactionClient.wallet.findMany.mockResolvedValueOnce([
      buildWallet({
        id: 'wallet-seller',
        userId: 'seller',
        reservedBtc: '1',
      }),
      buildWallet({
        id: 'wallet-buyer',
        userId: 'buyer',
        reservedUsd: '10000',
      }),
    ]);
    transactionClient.trade.create.mockResolvedValueOnce({
      id: 'trade-1',
    });

    await matchingService.processOrder(taker.id);

    expect(transactionClient.wallet.update.mock.calls).toEqual([
      [
        {
          where: {
            userId: 'seller',
          },
          data: {
            reservedBtc: {
              decrement: new Prisma.Decimal('1'),
            },
            availableUsd: {
              increment: new Prisma.Decimal('9970'),
            },
          },
        },
      ],
      [
        {
          where: {
            userId: 'buyer',
          },
          data: {
            reservedUsd: {
              decrement: new Prisma.Decimal('10000'),
            },
            availableBtc: {
              increment: new Prisma.Decimal('0.995'),
            },
          },
        },
      ],
    ]);
    expect(transactionClient.trade.create.mock.calls).toEqual([
      [
        {
          data: {
            makerOrderId: 'buy-maker',
            takerOrderId: 'sell-taker',
            buyOrderId: 'buy-maker',
            sellOrderId: 'sell-taker',
            takerSide: OrderSide.SELL,
            makerFeeRate: new Prisma.Decimal('0.005'),
            makerFeeAmount: new Prisma.Decimal('0.005'),
            makerFeeAsset: TradeFeeAsset.BTC,
            takerFeeRate: new Prisma.Decimal('0.003'),
            takerFeeAmount: new Prisma.Decimal('30'),
            takerFeeAsset: TradeFeeAsset.USD,
            price: new Prisma.Decimal('10000'),
            amount: new Prisma.Decimal('1'),
          },
        },
      ],
    ]);
    expect(realtimeOutboxService.appendEvents).toHaveBeenCalledWith(
      transactionClient,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'market.changed',
          reason: 'trade-executed',
          orderId: 'sell-taker',
          tradeIds: ['trade-1'],
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'sell-taker',
          tradeIds: ['trade-1'],
          userId: 'seller',
        }),
        expect.objectContaining({
          type: 'account.changed',
          reason: 'trade-executed',
          orderId: 'sell-taker',
          tradeIds: ['trade-1'],
          userId: 'buyer',
        }),
      ]),
    );
  });

  it('should quantize executed cost and fees to 8 decimal places before persisting balances', async () => {
    const taker = buildOrder({
      id: 'sell-taker-rounded',
      userId: 'seller',
      side: OrderSide.SELL,
      status: OrderStatus.QUEUED,
      price: '0.33333333',
      originalAmount: '0.1',
      remainingAmount: '0.1',
    });
    const maker = buildOrder({
      id: 'buy-maker-rounded',
      userId: 'buyer',
      side: OrderSide.BUY,
      status: OrderStatus.OPEN,
      price: '0.33333333',
      originalAmount: '0.1',
      remainingAmount: '0.1',
    });

    transactionClient.order.findUnique
      .mockResolvedValueOnce(taker)
      .mockResolvedValueOnce(maker);
    transactionClient.order.findMany.mockResolvedValueOnce([{ id: maker.id }]);
    transactionClient.$queryRaw
      .mockResolvedValueOnce([{ id: taker.id }])
      .mockResolvedValueOnce([{ id: maker.id }])
      .mockResolvedValueOnce([{ id: 'wallet-seller' }, { id: 'wallet-buyer' }]);
    transactionClient.wallet.findMany.mockResolvedValueOnce([
      buildWallet({
        id: 'wallet-seller',
        userId: 'seller',
        reservedBtc: '0.1',
      }),
      buildWallet({
        id: 'wallet-buyer',
        userId: 'buyer',
        reservedUsd: '0.03333333',
      }),
    ]);
    transactionClient.trade.create.mockResolvedValueOnce({
      id: 'trade-1',
    });

    await matchingService.processOrder(taker.id);

    expect(transactionClient.wallet.update.mock.calls).toEqual([
      [
        {
          where: {
            userId: 'seller',
          },
          data: {
            reservedBtc: {
              decrement: new Prisma.Decimal('0.1'),
            },
            availableUsd: {
              increment: new Prisma.Decimal('0.03323334'),
            },
          },
        },
      ],
      [
        {
          where: {
            userId: 'buyer',
          },
          data: {
            reservedUsd: {
              decrement: new Prisma.Decimal('0.03333333'),
            },
            availableBtc: {
              increment: new Prisma.Decimal('0.09950000'),
            },
          },
        },
      ],
    ]);

    expect(transactionClient.trade.create).toHaveBeenCalledWith({
      data: {
        makerOrderId: 'buy-maker-rounded',
        takerOrderId: 'sell-taker-rounded',
        buyOrderId: 'buy-maker-rounded',
        sellOrderId: 'sell-taker-rounded',
        takerSide: OrderSide.SELL,
        makerFeeRate: new Prisma.Decimal('0.005'),
        makerFeeAmount: new Prisma.Decimal('0.00050000'),
        makerFeeAsset: TradeFeeAsset.BTC,
        takerFeeRate: new Prisma.Decimal('0.003'),
        takerFeeAmount: new Prisma.Decimal('0.00009999'),
        takerFeeAsset: TradeFeeAsset.USD,
        price: new Prisma.Decimal('0.33333333'),
        amount: new Prisma.Decimal('0.1'),
      },
    });
  });

  it('should ignore reprocessing for an order that is no longer queued', async () => {
    transactionClient.order.findUnique.mockResolvedValueOnce(
      buildOrder({
        status: OrderStatus.OPEN,
      }),
    );
    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: 'order-1' }]);

    await expect(
      matchingService.processOrder('order-1'),
    ).resolves.toBeUndefined();

    expect(transactionClient.trade.create).not.toHaveBeenCalled();
    expect(transactionClient.order.update).not.toHaveBeenCalled();
    expect(transactionClient.wallet.update).not.toHaveBeenCalled();
    expect(realtimeOutboxService.appendEvents).not.toHaveBeenCalled();
  });

  it('should not match an order against another order from the same user', async () => {
    const taker = buildOrder({
      id: 'buy-taker',
      userId: 'trader',
      side: OrderSide.BUY,
      status: OrderStatus.QUEUED,
    });

    transactionClient.order.findUnique.mockResolvedValueOnce(taker);
    transactionClient.order.findMany.mockResolvedValueOnce([]);
    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: taker.id }]);

    await matchingService.processOrder(taker.id);

    expect(transactionClient.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { not: 'trader' },
        }),
      }),
    );
    expect(transactionClient.trade.create).not.toHaveBeenCalled();
    expect(transactionClient.wallet.update).not.toHaveBeenCalled();
    expect(transactionClient.order.update).toHaveBeenCalledWith({
      where: { id: taker.id },
      data: { status: OrderStatus.OPEN },
    });
  });

  it('should reject a queued order and release its reserved funds after retries fail', async () => {
    const order = buildOrder({
      id: 'queued-buy',
      userId: 'buyer',
      side: OrderSide.BUY,
      status: OrderStatus.QUEUED,
      price: '10000',
      remainingAmount: '0.5',
    });

    transactionClient.$queryRaw.mockResolvedValueOnce([{ id: order.id }]);
    transactionClient.order.findUnique.mockResolvedValueOnce(order);
    transactionClient.order.update.mockResolvedValueOnce({
      ...order,
      status: OrderStatus.REJECTED,
    });
    transactionClient.wallet.update.mockResolvedValueOnce(
      buildWallet({
        userId: 'buyer',
      }),
    );

    await matchingService.rejectOrderAfterFailedProcessing(order.id);

    expect(transactionClient.order.update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: { status: OrderStatus.REJECTED },
    });
    expect(transactionClient.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'buyer' },
      data: {
        availableUsd: { increment: new Prisma.Decimal('5000') },
        reservedUsd: { decrement: new Prisma.Decimal('5000') },
      },
    });
    expect(realtimeOutboxService.appendEvent).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        type: 'account.changed',
        reason: 'order-rejected',
        orderId: order.id,
        userId: 'buyer',
      }),
    );
    expect(realtimeOutboxDispatcherService.dispatchPending).toHaveBeenCalled();
  });

  it('should fail when the queued order does not exist', async () => {
    transactionClient.order.findUnique.mockResolvedValueOnce(null);
    transactionClient.$queryRaw.mockResolvedValueOnce([]);

    await expect(matchingService.processOrder('missing-order')).rejects.toThrow(
      new NotFoundException('Order missing-order not found'),
    );
  });
});
