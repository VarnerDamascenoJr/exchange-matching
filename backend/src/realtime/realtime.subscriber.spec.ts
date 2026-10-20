import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSubscriberService } from './realtime.subscriber';
import { REALTIME_EVENTS_CHANNEL } from './realtime.constants';
import { RealtimeDispatchEvent } from './realtime.types';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

const event: RealtimeDispatchEvent = {
  type: 'account.changed',
  reason: 'order-created',
  userId: 'user-1',
  occurredAt: '2026-10-15T18:00:00Z',
};

describe('RealtimeSubscriberService', () => {
  let service: RealtimeSubscriberService;
  let connection: { on: jest.Mock; subscribe: jest.Mock; quit: jest.Mock };
  let gateway: { dispatchEvent: jest.Mock };
  let config: { get: jest.Mock; getOrThrow: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    connection = {
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    jest.mocked(Redis).mockImplementation(() => connection as unknown as Redis);
    gateway = { dispatchEvent: jest.fn() };
    config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'development' : false,
      ),
      getOrThrow: jest.fn((key: string) =>
        key === 'REDIS_HOST' ? 'localhost' : 6379,
      ),
    };
    service = new RealtimeSubscriberService(
      config as unknown as ConfigService,
      gateway as unknown as RealtimeGateway,
    );
  });

  function receive(channel: string, payload: string) {
    const messageRegistration = connection.on.mock.calls.find(
      ([name]) => name === 'message',
    );
    const listener = messageRegistration?.[1] as (
      channel: string,
      payload: string,
    ) => void;
    listener(channel, payload);
  }

  it('should subscribe to the configured Redis channel and deliver parsed events to the gateway', async () => {
    await service.onModuleInit();
    expect(Redis).toHaveBeenCalledWith({ host: 'localhost', port: 6379 });
    expect(connection.subscribe).toHaveBeenCalledWith(REALTIME_EVENTS_CHANNEL);
    receive(REALTIME_EVENTS_CHANNEL, JSON.stringify(event));
    expect(gateway.dispatchEvent).toHaveBeenCalledWith(event);
  });

  it('should ignore messages from other channels', async () => {
    await service.onModuleInit();
    receive('another-channel', JSON.stringify(event));
    expect(gateway.dispatchEvent).not.toHaveBeenCalled();
  });

  it('should skip malformed JSON and still process the next valid message', async () => {
    await service.onModuleInit();
    receive(REALTIME_EVENTS_CHANNEL, '{invalid');
    expect(gateway.dispatchEvent).not.toHaveBeenCalled();
    receive(REALTIME_EVENTS_CHANNEL, JSON.stringify(event));
    expect(gateway.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('should skip subscriptions during ordinary unit tests', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'test' : false,
    );
    await service.onModuleInit();
    expect(Redis).not.toHaveBeenCalled();
    expect(connection.subscribe).not.toHaveBeenCalled();
  });

  it('should subscribe during database-backed E2E tests', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'test' : true,
    );
    await service.onModuleInit();
    expect(connection.subscribe).toHaveBeenCalledWith(REALTIME_EVENTS_CHANNEL);
  });

  it('should propagate subscription failures to initialization', async () => {
    const failure = new Error('Subscription failed');
    connection.subscribe.mockRejectedValueOnce(failure);
    await expect(service.onModuleInit()).rejects.toBe(failure);
  });

  it('should close an initialized connection when the module is destroyed', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });

  it('should not open a connection solely to destroy the module', async () => {
    await service.onModuleDestroy();
    expect(Redis).not.toHaveBeenCalled();
    expect(connection.quit).not.toHaveBeenCalled();
  });
});
