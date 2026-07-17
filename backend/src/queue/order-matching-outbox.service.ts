import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class OrderMatchingOutboxService {
  async appendOrder(
    transactionClient: TransactionClient,
    orderId: string,
  ): Promise<void> {
    await transactionClient.orderMatchingOutbox.create({
      data: {
        id: this.createOutboxId(),
        orderId,
      },
    });
  }

  private createOutboxId(): string {
    return `match_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
