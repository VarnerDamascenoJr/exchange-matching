import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class OrderLockingService {
  async lockAndLoadOrder(
    transactionClient: TransactionClient,
    orderId: string,
    userId?: string,
  ) {
    const lockedRows = userId
      ? await transactionClient.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "orders"
          WHERE "id" = ${orderId}
            AND "user_id" = ${userId}
          FOR UPDATE
        `
      : await transactionClient.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "orders"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;

    if (lockedRows.length === 0) {
      return null;
    }

    return userId
      ? transactionClient.order.findFirst({
          where: {
            id: orderId,
            userId,
          },
        })
      : transactionClient.order.findUnique({
          where: {
            id: orderId,
          },
        });
  }
}
