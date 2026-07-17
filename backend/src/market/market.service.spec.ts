import { BadRequestException } from '@nestjs/common';
import { OrderSide } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from './market.service';

describe('MarketService', () => {
  let marketService: MarketService;
  let prismaService: jest.Mocked<PrismaService>;
  let groupByMock: jest.Mock;

  beforeEach(() => {
    groupByMock = jest.fn();

    prismaService = {
      order: {
        groupBy: groupByMock,
      },
    } as unknown as jest.Mocked<PrismaService>;

    marketService = new MarketService(prismaService);
  });

  it('should reject invalid price filters before querying Prisma', async () => {
    await expect(
      marketService.getOrderBook({
        side: OrderSide.BUY,
        page: 1,
        pageSize: 25,
        price: 'abc',
      }),
    ).rejects.toEqual(new BadRequestException('price must be a valid decimal'));

    expect(groupByMock).not.toHaveBeenCalled();
  });
});
