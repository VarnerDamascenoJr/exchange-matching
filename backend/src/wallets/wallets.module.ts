import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

@Module({
  imports: [PrismaModule],
  providers: [WalletsRepository, WalletsService],
  exports: [WalletsRepository, WalletsService],
})
export class WalletsModule {}
