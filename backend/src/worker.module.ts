import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configModuleOptions } from './config/config-module-options';
import { MatchingModule } from './matching/matching.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrderMatchingProcessor } from './queue/order-matching.processor';
import { OrderMatchingWorker } from './queue/order-matching.worker';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    PrismaModule,
    MatchingModule,
    QueueModule,
  ],
  providers: [OrderMatchingProcessor, OrderMatchingWorker],
})
export class WorkerModule {}
