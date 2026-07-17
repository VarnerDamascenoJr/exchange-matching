import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { MarketService } from './market.service';
import { OrderBookQueryDto } from './dto/order-book.query.dto';

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get('stats')
  getStats() {
    return this.marketService.getStats();
  }

  @Get('order-book')
  getOrderBook(@Query() query: OrderBookQueryDto) {
    return this.marketService.getOrderBook(query);
  }

  @Get('matches')
  getMatches(@Query() query: PaginationQueryDto) {
    return this.marketService.getMatches(query.page, query.pageSize, query.id);
  }
}
