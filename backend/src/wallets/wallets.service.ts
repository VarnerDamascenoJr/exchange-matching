import { Injectable } from '@nestjs/common';
import { Wallet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletsService {
  constructor(private readonly prismaService: PrismaService) {}

  findByUserId(userId: string): Promise<Wallet | null> {
    return this.prismaService.wallet.findUnique({
      where: { userId },
    });
  }
}
