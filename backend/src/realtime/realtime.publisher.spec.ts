import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RealtimePublisherService } from './realtime.publisher';
import { REALTIME_EVENTS_CHANNEL } from './realtime.constants';
import { RealtimeDispatchEvent } from './realtime.types';
import { OUTBOX_REDIS_TIMEOUT_MS } from '../common/outbox-redis-options';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

const event: RealtimeDispatchEvent = {
  type: 'market.changed',
  reason: 'order-opened',
  occurredAt: '2026-10-15T18:00:00Z',
};

describe('RealtimePublisherService', () => {
  let service: RealtimePublisherService;
  let connection: {
    publish: jest.Mock;
    on: jest.Mock;
    quit: jest.Mock;
    disconnect: jest.Mock;
  };
  let config: { get: jest.Mock; getOrThrow: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    connection = {
      publish: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    jest.mocked(Redis).mockImplementation(() => connection as unknown as Redis);
    config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'development' : false,
      ),
      getOrThrow: jest.fn((key: string) =>
        key === 'REDIS_HOST' ? 'localhost' : 6379,
      ),
    };
    service = new RealtimePublisherService(config as unknown as ConfigService);
  });

  it('should lazily create one Redis connection and publish serialized events to the realtime channel', async () => {
    expect(Redis).not.toHaveBeenCalled();
    await service.publishEvent(event);
    await service.publishEvent(event);
    expect(Redis).toHaveBeenCalledTimes(1);
    expect(Redis).toHaveBeenCalledWith({
      host: 'localhost',
      port: 6379,
      connectTimeout: OUTBOX_REDIS_TIMEOUT_MS,
      commandTimeout: OUTBOX_REDIS_TIMEOUT_MS,
      maxRetriesPerRequest: 0,
      retryStrategy: expect.any(Function),
    });
    expect(connection.publish).toHaveBeenCalledWith(
      REALTIME_EVENTS_CHANNEL,
      JSON.stringify(event),
    );
    expect(connection.publish).toHaveBeenCalledTimes(2);
  });

  it('should skip Redis publication during ordinary unit tests', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'test' : false,
    );
    await service.publishEvent(event);
    expect(Redis).not.toHaveBeenCalled();
    expect(connection.publish).not.toHaveBeenCalled();
  });

  it('should allow publication during database-backed E2E tests', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'test' : true,
    );
    await service.publishEvent(event);
    expect(connection.publish).toHaveBeenCalledWith(
      REALTIME_EVENTS_CHANNEL,
      JSON.stringify(event),
    );
  });

  it('should propagate publication failures to the dispatcher', async () => {
    const failure = new Error('Redis unavailable');
    connection.publish.mockRejectedValueOnce(failure);
    await expect(service.publishEvent(event)).rejects.toBe(failure);
    expect(connection.disconnect).toHaveBeenCalledTimes(1);
    await service.publishEvent(event);
    expect(Redis).toHaveBeenCalledTimes(2);
  });

  it('should close an initialized Redis connection on shutdown', async () => {
    await service.publishEvent(event);
    await service.onApplicationShutdown();
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });

  it('should not create a connection solely to shut down', async () => {
    await service.onApplicationShutdown();
    expect(Redis).not.toHaveBeenCalled();
    expect(connection.quit).not.toHaveBeenCalled();
  });

  it('disconnects and handles errors if graceful Redis shutdown fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await service.publishEvent(event);
    connection.quit.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(connection.disconnect).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});
