import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeCoreModule } from './realtime-core.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSubscriberService } from './realtime.subscriber';

@Module({
  imports: [AuthModule, RealtimeCoreModule],
  providers: [RealtimeGateway, RealtimeSubscriberService],
  exports: [RealtimeCoreModule, RealtimeGateway],
})
export class RealtimeModule {}
