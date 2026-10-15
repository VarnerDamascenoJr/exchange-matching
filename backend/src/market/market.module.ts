import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketController } from './market.controller';
import { MarketRepository } from './market.repository';
import { MarketService } from './market.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MarketController],
  providers: [MarketService, MarketRepository],
  exports: [MarketService],
})
export class MarketModule {}
