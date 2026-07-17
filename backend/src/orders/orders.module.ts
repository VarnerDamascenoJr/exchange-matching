import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { RealtimeCoreModule } from '../realtime/realtime-core.module';
import { WalletsModule } from '../wallets/wallets.module';
import { OrderLockingService } from './order-locking.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, QueueModule, RealtimeCoreModule, WalletsModule],
  controllers: [OrdersController],
  providers: [OrderLockingService, OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
