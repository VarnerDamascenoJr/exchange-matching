import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderSide, Prisma, Wallet } from '@prisma/client';
import { multiplyScaled } from '../common/decimal.utils';
import { WalletsRepository } from './wallets.repository';

@Injectable()
export class WalletsService {
  constructor(private readonly walletsRepository: WalletsRepository) {}

  findByUserId(
    userId: string,
    transactionClient?: Prisma.TransactionClient,
  ): Promise<Wallet | null> {
    return this.walletsRepository.findByUserId(userId, transactionClient);
  }

  async reserveFunds(
    transactionClient: Prisma.TransactionClient,
    wallet: Wallet,
    side: OrderSide,
    amount: Prisma.Decimal,
    price: Prisma.Decimal,
  ): Promise<void> {
    const asset = side === OrderSide.BUY ? 'USD' : 'BTC';
    const requiredAmount =
      side === OrderSide.BUY ? multiplyScaled(amount, price) : amount;
    const updatedWallet = await this.walletsRepository.reserveFunds(
      transactionClient,
      wallet.userId,
      asset,
      requiredAmount,
    );

    if (updatedWallet.count === 0) {
      throw new BadRequestException(`Insufficient ${asset} balance`);
    }
  }

  async releaseFunds(
    transactionClient: Prisma.TransactionClient,
    order: {
      userId: string;
      side: OrderSide;
      price: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
    },
  ): Promise<void> {
    const asset = order.side === OrderSide.BUY ? 'USD' : 'BTC';
    const releasedAmount =
      order.side === OrderSide.BUY
        ? multiplyScaled(order.remainingAmount, order.price)
        : order.remainingAmount;

    await this.walletsRepository.releaseFunds(
      transactionClient,
      order.userId,
      asset,
      releasedAmount,
    );
  }
}
