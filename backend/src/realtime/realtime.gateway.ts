import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  ACCOUNT_CHANGED_EVENT,
  MARKET_CHANGED_EVENT,
  USER_ROOM_PREFIX,
} from './realtime.constants';
import { JwtPayload } from '../auth/auth.types';
import { RealtimeDispatchEvent } from './realtime.types';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  @WebSocketServer()
  server!: Server;

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      await client.join(this.buildUserRoom(payload.sub));
    } catch (error) {
      this.logger.warn(
        `Rejected realtime socket connection: ${
          error instanceof Error ? error.message : 'invalid token'
        }`,
      );
      client.disconnect(true);
    }
  }

  dispatchEvent(event: RealtimeDispatchEvent) {
    if (!this.server) {
      return;
    }

    if (event.type === 'market.changed') {
      this.server.emit(MARKET_CHANGED_EVENT, event);
      this.logger.debug(`Broadcasted market event: ${event.reason}`);
      return;
    }

    this.server
      .to(this.buildUserRoom(event.userId))
      .emit(ACCOUNT_CHANGED_EVENT, event);
    this.logger.debug(
      `Broadcasted account event ${event.reason} to user ${event.userId}`,
    );
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown };
    const authToken = auth.token;
    const token = typeof authToken === 'string' ? authToken.trim() : undefined;

    if (!token) {
      return null;
    }

    return token.startsWith('Bearer ') ? token.slice('Bearer '.length) : token;
  }

  private buildUserRoom(userId: string) {
    return `${USER_ROOM_PREFIX}${userId}`;
  }
}
