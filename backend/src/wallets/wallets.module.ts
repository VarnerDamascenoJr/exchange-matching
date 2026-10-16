import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletFundsService } from './wallet-funds.service';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

@Module({
  imports: [PrismaModule],
  providers: [WalletFundsService, WalletsRepository, WalletsService],
  exports: [WalletFundsService, WalletsRepository, WalletsService],
})
export class WalletsModule {}
