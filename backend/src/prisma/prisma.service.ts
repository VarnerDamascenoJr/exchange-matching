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
    if (!this.shouldConnect()) {
      return;
    }

    await this.$connect();
    this.logger.log('Connected to PostgreSQL through Prisma');
  }

  async onModuleDestroy() {
    if (!this.shouldConnect()) {
      return;
    }

    await this.$disconnect();
    this.logger.log('Disconnected Prisma client');
  }

  private shouldConnect(): boolean {
    return (
      this.configService.get<string>('NODE_ENV') !== 'test' ||
      this.configService.get<boolean>('RUN_DATABASE_E2E') === true
    );
  }
}
