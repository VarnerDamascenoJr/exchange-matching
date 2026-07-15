import { existsSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { resolve } from 'node:path';
import { Prisma, PrismaClient, OrderSide, OrderStatus, TradeFeeAsset } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  ORDER_MATCHING_QUEUE_NAME,
  PROCESS_ORDER_JOB_NAME,
} from '../src/queue/order-matching.constants';

const DECIMAL = (value: string) => new Prisma.Decimal(value);
const MAKER_FEE_RATE = DECIMAL('0.005');
const TAKER_FEE_RATE = DECIMAL('0.003');

function loadEnvironmentFile() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf('=');

      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + 1).trim();

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  process.env.POSTGRES_HOST ??= 'localhost';
  process.env.POSTGRES_PORT ??= '5432';
  process.env.POSTGRES_DB ??= 'wisiex_order_matching';
  process.env.POSTGRES_USER ??= 'postgres';
  process.env.POSTGRES_PASSWORD ??= 'postgres';
  process.env.DATABASE_URL ??=
    `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}` +
    `@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}` +
    `/${process.env.POSTGRES_DB}?schema=public`;
  process.env.REDIS_HOST ??= 'localhost';
  process.env.REDIS_PORT ??= '6379';
}

loadEnvironmentFile();

const prisma = new PrismaClient();

function createRedisQueue() {
  return new Queue<{ orderId: string }>(ORDER_MATCHING_QUEUE_NAME, {
    connection: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
    },
  });
}

async function isTcpServiceAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = new Socket();

    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolvePromise(false);
    });

    socket.connect(port, host);
  });
}

async function resetDatabase() {
  await prisma.user.deleteMany();
}

async function createSeedUsers() {
  await prisma.user.create({
    data: {
      id: 'seed-seller-1',
      username: 'seed_seller_1',
      wallet: {
        create: {
          availableBtc: DECIMAL('99.60000000'),
          reservedBtc: DECIMAL('0.40000000'),
          availableUsd: DECIMAL('100000.00000000'),
          reservedUsd: DECIMAL('0.00000000'),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      id: 'seed-seller-2',
      username: 'seed_seller_2',
      wallet: {
        create: {
          availableBtc: DECIMAL('99.70000000'),
          reservedBtc: DECIMAL('0.30000000'),
          availableUsd: DECIMAL('100000.00000000'),
          reservedUsd: DECIMAL('0.00000000'),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      id: 'seed-buyer-1',
      username: 'seed_buyer_1',
      wallet: {
        create: {
          availableBtc: DECIMAL('100.00000000'),
          reservedBtc: DECIMAL('0.00000000'),
          availableUsd: DECIMAL('95600.00000000'),
          reservedUsd: DECIMAL('4400.00000000'),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      id: 'seed-queue-buyer',
      username: 'seed_queue_buyer',
      wallet: {
        create: {
          availableBtc: DECIMAL('100.00000000'),
          reservedBtc: DECIMAL('0.00000000'),
          availableUsd: DECIMAL('90000.00000000'),
          reservedUsd: DECIMAL('10000.00000000'),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      id: 'seed-queue-seller',
      username: 'seed_queue_seller',
      wallet: {
        create: {
          availableBtc: DECIMAL('99.40000000'),
          reservedBtc: DECIMAL('0.60000000'),
          availableUsd: DECIMAL('100000.00000000'),
          reservedUsd: DECIMAL('0.00000000'),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      id: 'seed-history-seller',
      username: 'seed_history_seller',
      wallet: {
        create: {
          availableBtc: DECIMAL('99.00000000'),
          reservedBtc: DECIMAL('0.25000000'),
          availableUsd: DECIMAL('107537.12500000'),
          reservedUsd: DECIMAL('0.00000000'),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      id: 'seed-history-buyer',
      username: 'seed_history_buyer',
      wallet: {
        create: {
          availableBtc: DECIMAL('100.74775000'),
          reservedBtc: DECIMAL('0.00000000'),
          availableUsd: DECIMAL('92425.00000000'),
          reservedUsd: DECIMAL('0.00000000'),
        },
      },
    },
  });
}

async function createSeedOrdersAndTrades() {
  await prisma.order.create({
    data: {
      id: 'seed-sell-open-1',
      userId: 'seed-seller-1',
      side: OrderSide.SELL,
      status: OrderStatus.OPEN,
      price: DECIMAL('9000.00000000'),
      originalAmount: DECIMAL('0.40000000'),
      remainingAmount: DECIMAL('0.40000000'),
    },
  });

  await prisma.order.create({
    data: {
      id: 'seed-sell-open-2',
      userId: 'seed-seller-2',
      side: OrderSide.SELL,
      status: OrderStatus.OPEN,
      price: DECIMAL('9500.00000000'),
      originalAmount: DECIMAL('0.30000000'),
      remainingAmount: DECIMAL('0.30000000'),
    },
  });

  await prisma.order.create({
    data: {
      id: 'seed-buy-open-1',
      userId: 'seed-buyer-1',
      side: OrderSide.BUY,
      status: OrderStatus.OPEN,
      price: DECIMAL('8800.00000000'),
      originalAmount: DECIMAL('0.50000000'),
      remainingAmount: DECIMAL('0.50000000'),
    },
  });

  await prisma.order.create({
    data: {
      id: 'seed-buy-queued-1',
      userId: 'seed-queue-buyer',
      side: OrderSide.BUY,
      status: OrderStatus.QUEUED,
      price: DECIMAL('10000.00000000'),
      originalAmount: DECIMAL('1.00000000'),
      remainingAmount: DECIMAL('1.00000000'),
    },
  });

  await prisma.order.create({
    data: {
      id: 'seed-sell-queued-1',
      userId: 'seed-queue-seller',
      side: OrderSide.SELL,
      status: OrderStatus.QUEUED,
      price: DECIMAL('8700.00000000'),
      originalAmount: DECIMAL('0.60000000'),
      remainingAmount: DECIMAL('0.60000000'),
    },
  });

  await prisma.order.create({
    data: {
      id: 'seed-history-sell-maker',
      userId: 'seed-history-seller',
      side: OrderSide.SELL,
      status: OrderStatus.PARTIALLY_FILLED,
      price: DECIMAL('10100.00000000'),
      originalAmount: DECIMAL('1.00000000'),
      remainingAmount: DECIMAL('0.25000000'),
    },
  });

  await prisma.order.create({
    data: {
      id: 'seed-history-buy-taker',
      userId: 'seed-history-buyer',
      side: OrderSide.BUY,
      status: OrderStatus.FILLED,
      price: DECIMAL('10200.00000000'),
      originalAmount: DECIMAL('0.75000000'),
      remainingAmount: DECIMAL('0.00000000'),
    },
  });

  await prisma.trade.create({
    data: {
      id: 'seed-trade-history-1',
      makerOrderId: 'seed-history-sell-maker',
      takerOrderId: 'seed-history-buy-taker',
      buyOrderId: 'seed-history-buy-taker',
      sellOrderId: 'seed-history-sell-maker',
      takerSide: OrderSide.BUY,
      makerFeeRate: MAKER_FEE_RATE,
      makerFeeAmount: DECIMAL('37.87500000'),
      makerFeeAsset: TradeFeeAsset.USD,
      takerFeeRate: TAKER_FEE_RATE,
      takerFeeAmount: DECIMAL('0.00225000'),
      takerFeeAsset: TradeFeeAsset.BTC,
      price: DECIMAL('10100.00000000'),
      amount: DECIMAL('0.75000000'),
    },
  });
}

async function enqueueQueuedOrders() {
  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const redisIsAvailable = await isTcpServiceAvailable(host, port);

  if (!redisIsAvailable) {
    console.warn('Skipping queue seed because Redis is unavailable.');
    return;
  }

  const queue = createRedisQueue();

  try {
    const existingBuyJob = await queue.getJob('seed-buy-queued-1');
    const existingSellJob = await queue.getJob('seed-sell-queued-1');

    if (existingBuyJob) {
      await existingBuyJob.remove();
    }

    if (existingSellJob) {
      await existingSellJob.remove();
    }

    await queue.add(
      PROCESS_ORDER_JOB_NAME,
      { orderId: 'seed-buy-queued-1' },
      {
        jobId: 'seed-buy-queued-1',
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    await queue.add(
      PROCESS_ORDER_JOB_NAME,
      { orderId: 'seed-sell-queued-1' },
      {
        jobId: 'seed-sell-queued-1',
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  } catch (error) {
    console.warn('Skipping queue seed because Redis is unavailable.', error);
  } finally {
    await queue.close();
  }
}

async function main() {
  await resetDatabase();
  await createSeedUsers();
  await createSeedOrdersAndTrades();
  await enqueueQueuedOrders();

  console.log('Seeded matching scenarios with open, queued and historical orders.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
