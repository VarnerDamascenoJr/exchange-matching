import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderSide,
  OrderStatus,
  Prisma,
  PrismaClient,
  Wallet,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderSummary, toOrderSummary } from './order.mapper';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class OrdersService {
  constructor(private readonly prismaService: PrismaService) {}

  private static readonly DECIMAL_PRECISION = 28;
  private static readonly DECIMAL_SCALE = 8;

  private readonly activeStatuses = [
    OrderStatus.QUEUED,
    OrderStatus.OPEN,
    OrderStatus.PARTIALLY_FILLED,
  ] as const;

  async createOrder(
    userId: string,
    side: OrderSide,
    amountInput: string,
    priceInput: string,
  ): Promise<OrderSummary> {
    const amount = this.parsePositiveDecimal(amountInput, 'amount');
    const price = this.parsePositiveDecimal(priceInput, 'price');

    return this.prismaService.$transaction(async (transactionClient) => {
      const wallet = await transactionClient.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      await this.reserveFunds(transactionClient, wallet, side, amount, price);

      const order = await transactionClient.order.create({
        data: {
          userId,
          side,
          status: OrderStatus.QUEUED,
          price,
          originalAmount: amount,
          remainingAmount: amount,
        },
      });

      return toOrderSummary(order);
    });
  }

  async getActiveOrders(userId: string): Promise<OrderSummary[]> {
    const orders = await this.prismaService.order.findMany({
      where: {
        userId,
        status: {
          in: [...this.activeStatuses],
        },
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          sequence: 'desc',
        },
      ],
    });

    return orders.map(toOrderSummary);
  }

  async cancelOrder(userId: string, orderId: string): Promise<OrderSummary> {
    return this.prismaService.$transaction(async (transactionClient) => {
      const order = await transactionClient.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (!this.isActiveStatus(order.status)) {
        throw new BadRequestException('Order cannot be cancelled');
      }

      const wallet = await transactionClient.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      const updatedOrderResult = await transactionClient.order.updateMany({
        where: {
          id: orderId,
          userId,
          status: {
            in: [...this.activeStatuses],
          },
        },
        data: {
          status: OrderStatus.CANCELLED,
        },
      });

      if (updatedOrderResult.count === 0) {
        throw new BadRequestException('Order cannot be cancelled');
      }

      await this.releaseFunds(transactionClient, order);

      return toOrderSummary({
        ...order,
        status: OrderStatus.CANCELLED,
        updatedAt: new Date(),
      });
    });
  }

  private parsePositiveDecimal(
    value: string,
    fieldName: string,
  ): Prisma.Decimal {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }

    try {
      const parsedValue = new Prisma.Decimal(normalizedValue);

      if (!parsedValue.isFinite()) {
        throw new BadRequestException(`${fieldName} must be a valid decimal`);
      }

      if (parsedValue.lte(0)) {
        throw new BadRequestException(`${fieldName} must be greater than zero`);
      }

      this.assertDecimalFitsSchema(parsedValue, fieldName);

      return parsedValue;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(`${fieldName} must be a valid decimal`);
    }
  }

  private assertDecimalFitsSchema(value: Prisma.Decimal, fieldName: string) {
    const normalizedValue = value.toFixed();
    const unsignedValue = normalizedValue.startsWith('-')
      ? normalizedValue.slice(1)
      : normalizedValue;
    const [integerPart, fractionalPart = ''] = unsignedValue.split('.');
    const normalizedIntegerPart = integerPart.replace(/^0+(?=\d)/, '');
    const integerDigits =
      normalizedIntegerPart.length > 0 ? normalizedIntegerPart.length : 1;
    const significantFractionalPart = fractionalPart.replace(/0+$/, '');
    const fractionalDigits = significantFractionalPart.length;
    const totalDigits = integerDigits + fractionalDigits;

    if (fractionalDigits > OrdersService.DECIMAL_SCALE) {
      throw new BadRequestException(
        `${fieldName} must have at most ${OrdersService.DECIMAL_SCALE} decimal places`,
      );
    }

    if (totalDigits > OrdersService.DECIMAL_PRECISION) {
      throw new BadRequestException(
        `${fieldName} must fit within DECIMAL(${OrdersService.DECIMAL_PRECISION},${OrdersService.DECIMAL_SCALE})`,
      );
    }
  }

  private async reserveFunds(
    transactionClient: TransactionClient,
    wallet: Wallet,
    side: OrderSide,
    amount: Prisma.Decimal,
    price: Prisma.Decimal,
  ) {
    if (side === OrderSide.BUY) {
      const requiredUsd = amount.mul(price);
      const updatedWallet = await transactionClient.wallet.updateMany({
        where: {
          userId: wallet.userId,
          availableUsd: {
            gte: requiredUsd,
          },
        },
        data: {
          availableUsd: {
            decrement: requiredUsd,
          },
          reservedUsd: {
            increment: requiredUsd,
          },
        },
      });

      if (updatedWallet.count === 0) {
        throw new BadRequestException('Insufficient USD balance');
      }

      return;
    }

    const updatedWallet = await transactionClient.wallet.updateMany({
      where: {
        userId: wallet.userId,
        availableBtc: {
          gte: amount,
        },
      },
      data: {
        availableBtc: {
          decrement: amount,
        },
        reservedBtc: {
          increment: amount,
        },
      },
    });

    if (updatedWallet.count === 0) {
      throw new BadRequestException('Insufficient BTC balance');
    }
  }

  private isActiveStatus(
    status: OrderStatus,
  ): status is (typeof this.activeStatuses)[number] {
    return (
      status === OrderStatus.QUEUED ||
      status === OrderStatus.OPEN ||
      status === OrderStatus.PARTIALLY_FILLED
    );
  }

  private async releaseFunds(
    transactionClient: TransactionClient,
    order: {
      userId: string;
      side: OrderSide;
      price: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
    },
  ) {
    if (order.side === OrderSide.BUY) {
      const releasedUsd = order.remainingAmount.mul(order.price);
      await transactionClient.wallet.update({
        where: {
          userId: order.userId,
        },
        data: {
          availableUsd: {
            increment: releasedUsd,
          },
          reservedUsd: {
            decrement: releasedUsd,
          },
        },
      });

      return;
    }

    await transactionClient.wallet.update({
      where: {
        userId: order.userId,
      },
      data: {
        availableBtc: {
          increment: order.remainingAmount,
        },
        reservedBtc: {
          decrement: order.remainingAmount,
        },
      },
    });
  }
}
