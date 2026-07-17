import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeCoreModule } from '../realtime/realtime-core.module';
import { WalletsModule } from '../wallets/wallets.module';
import { OrderLockingService } from '../orders/order-locking.service';
import { MatchingOrderBookService } from './matching-order-book.service';
import { MatchingService } from './matching.service';
import { TradeSettlementService } from './trade-settlement.service';

@Module({
  imports: [PrismaModule, RealtimeCoreModule, WalletsModule],
  providers: [
    MatchingOrderBookService,
    OrderLockingService,
    TradeSettlementService,
    MatchingService,
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
