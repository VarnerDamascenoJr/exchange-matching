import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { TradesService } from './trades.service';

@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Get('history')
  getUserHistory(
    @CurrentUser() currentUser: JwtPayload,
    @Query() query: PaginationQueryDto,
  ) {
    return this.tradesService.getUserHistory(
      currentUser.sub,
      query.page,
      query.pageSize,
      query.id,
    );
  }
}
