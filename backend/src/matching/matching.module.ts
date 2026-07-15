import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchingService } from './matching.service';

@Module({
  imports: [PrismaModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
