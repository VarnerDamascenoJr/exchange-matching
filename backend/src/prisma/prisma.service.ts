import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async onModuleInit() {
    if (this.configService.get<string>('NODE_ENV') === 'test') {
      return;
    }

    await this.$connect();
    this.logger.log('Connected to PostgreSQL through Prisma');
  }

  async onModuleDestroy() {
    if (this.configService.get<string>('NODE_ENV') === 'test') {
      return;
    }

    await this.$disconnect();
    this.logger.log('Disconnected Prisma client');
  }
}
