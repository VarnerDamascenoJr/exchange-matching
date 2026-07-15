import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('active')
  getActiveOrders(@CurrentUser() currentUser: JwtPayload) {
    return this.ordersService.getActiveOrders(currentUser.sub);
  }

  @Post()
  createOrder(
    @CurrentUser() currentUser: JwtPayload,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(
      currentUser.sub,
      createOrderDto.side,
      createOrderDto.amount,
      createOrderDto.price,
    );
  }

  @Delete(':id')
  cancelOrder(
    @CurrentUser() currentUser: JwtPayload,
    @Param('id') orderId: string,
  ) {
    return this.ordersService.cancelOrder(currentUser.sub, orderId);
  }
}
