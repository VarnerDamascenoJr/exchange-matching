import { Module } from '@nestjs/common';
import { WalletFundsService } from './wallet-funds.service';
import { WalletsService } from './wallets.service';

@Module({
  providers: [WalletFundsService, WalletsService],
  exports: [WalletFundsService, WalletsService],
})
export class WalletsModule {}
