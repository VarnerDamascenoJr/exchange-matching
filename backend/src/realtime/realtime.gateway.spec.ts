import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';
import {
  ACCOUNT_CHANGED_EVENT,
  MARKET_CHANGED_EVENT,
} from './realtime.constants';
import { RealtimeDispatchEvent } from './realtime.types';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwt: { verifyAsync: jest.Mock };
  let server: { emit: jest.Mock; to: jest.Mock };
  let roomEmit: jest.Mock;

  beforeEach(() => {
    jwt = {
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', username: 'alice' }),
    };
    gateway = new RealtimeGateway(jwt as unknown as JwtService);
    roomEmit = jest.fn();
    server = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: roomEmit }),
    };
    gateway.server = server as unknown as Server;
  });

  function createSocket(token?: unknown) {
    const socket = {
      handshake: { auth: { token } },
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    return { socket, client: socket as unknown as Socket };
  }

  it.each(['signed-token', '  Bearer signed-token  '])(
    'should authenticate a socket and join only the token subject’s room (%s)',
    async (token) => {
      const { socket, client } = createSocket(token);
      await gateway.handleConnection(client);
      expect(jwt.verifyAsync).toHaveBeenCalledWith('signed-token');
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, '', '   ', 123])(
    'should disconnect sockets without a usable token (%s)',
    async (token) => {
      const { socket, client } = createSocket(token);
      await gateway.handleConnection(client);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    },
  );

  it('should disconnect invalid JWTs without joining a user room', async () => {
    const { socket, client } = createSocket('invalid');
    jwt.verifyAsync.mockRejectedValueOnce(new Error('Invalid token'));
    await gateway.handleConnection(client);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('should broadcast market events to all connected sockets', () => {
    const event: RealtimeDispatchEvent = {
      type: 'market.changed',
      reason: 'order-opened',
      occurredAt: '2026-10-15T18:00:00Z',
    };
    gateway.dispatchEvent(event);
    expect(server.emit).toHaveBeenCalledWith(MARKET_CHANGED_EVENT, event);
    expect(server.to).not.toHaveBeenCalled();
  });

  it('should send account events only to the affected user’s room', () => {
    const event: RealtimeDispatchEvent = {
      type: 'account.changed',
      reason: 'order-created',
      userId: 'user-2',
      occurredAt: '2026-10-15T18:00:00Z',
    };
    gateway.dispatchEvent(event);
    expect(server.to).toHaveBeenCalledWith('user:user-2');
    expect(roomEmit).toHaveBeenCalledWith(ACCOUNT_CHANGED_EVENT, event);
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('should tolerate events before the websocket server is initialized', () => {
    const uninitializedGateway = new RealtimeGateway(
      jwt as unknown as JwtService,
    );
    expect(() =>
      uninitializedGateway.dispatchEvent({
        type: 'market.changed',
        reason: 'order-opened',
        occurredAt: '2026-10-15T18:00:00Z',
      }),
    ).not.toThrow();
  });
});
