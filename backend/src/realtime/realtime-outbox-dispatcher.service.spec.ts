import { ConfigService } from '@nestjs/config';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
import { RealtimePublisherService } from './realtime.publisher';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';
import { RealtimeDispatchEvent } from './realtime.types';
import {
  REALTIME_OUTBOX_BATCH_SIZE,
  REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
  REALTIME_OUTBOX_MAX_ATTEMPTS,
  REALTIME_OUTBOX_POLL_INTERVAL_MS,
} from './realtime.constants';

const event: RealtimeDispatchEvent = {
  type: 'market.changed',
  reason: 'order-opened',
  occurredAt: '2026-10-15T18:00:00Z',
};

describe('RealtimeOutboxDispatcherService', () => {
  let dispatcher: RealtimeOutboxDispatcherService;
  let repository: jest.Mocked<RealtimeOutboxRepository>;
  let publisher: jest.Mocked<RealtimePublisherService>;
  let config: { get: jest.Mock };

  beforeEach(() => {
    repository = {
      claimNextBatch: jest.fn().mockResolvedValue([]),
      markAsPublished: jest.fn(),
      releaseClaim: jest.fn(),
      pruneExpiredEvents: jest.fn(),
    } as unknown as jest.Mocked<RealtimeOutboxRepository>;
    publisher = {
      publishEvent: jest.fn(),
    } as unknown as jest.Mocked<RealtimePublisherService>;
    config = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : false)),
    };
    dispatcher = new RealtimeOutboxDispatcherService(
      repository,
      config as unknown as ConfigService,
      publisher,
    );
  });

  afterEach(async () => {
    await dispatcher.onApplicationShutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should claim bounded batches with the configured lease timeout', async () => {
    await dispatcher.dispatchPending();
    expect(repository.claimNextBatch).toHaveBeenCalledWith(
      expect.stringMatching(/^claim_/),
      REALTIME_OUTBOX_BATCH_SIZE,
      REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
    );
    expect(publisher.publishEvent).not.toHaveBeenCalled();
  });

  it.each([event, JSON.stringify(event)])(
    'should normalize and publish stored payloads before acknowledging their claims (%j)',
    async (payload) => {
      repository.claimNextBatch.mockResolvedValueOnce([
        { id: 'event-1', claim_token: 'claim-1', payload },
      ]);
      repository.markAsPublished.mockImplementationOnce(() => {
        expect(publisher.publishEvent).toHaveBeenCalledWith(event);
        return Promise.resolve();
      });
      await dispatcher.dispatchPending();
      expect(repository.markAsPublished).toHaveBeenCalledWith(
        'event-1',
        'claim-1',
      );
      expect(repository.releaseClaim).not.toHaveBeenCalled();
      expect(repository.claimNextBatch).toHaveBeenCalledTimes(2);
    },
  );

  it('should release failed publications with the retry threshold and continue with later events', async () => {
    repository.claimNextBatch.mockResolvedValueOnce([
      { id: 'event-1', claim_token: 'claim-1', payload: event },
      { id: 'event-2', claim_token: 'claim-1', payload: event },
    ]);
    publisher.publishEvent.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );
    await dispatcher.dispatchPending();
    expect(repository.releaseClaim).toHaveBeenCalledWith(
      'event-1',
      'claim-1',
      'Redis unavailable',
      REALTIME_OUTBOX_MAX_ATTEMPTS,
    );
    expect(repository.markAsPublished).toHaveBeenCalledTimes(1);
    expect(repository.markAsPublished).toHaveBeenCalledWith(
      'event-2',
      'claim-1',
    );
  });

  it('should release malformed JSON without publishing it', async () => {
    repository.claimNextBatch.mockResolvedValueOnce([
      { id: 'event-1', claim_token: 'claim-1', payload: '{invalid' },
    ]);
    await dispatcher.dispatchPending();
    expect(publisher.publishEvent).not.toHaveBeenCalled();
    expect(repository.releaseClaim).toHaveBeenCalledWith(
      'event-1',
      'claim-1',
      expect.any(String),
      REALTIME_OUTBOX_MAX_ATTEMPTS,
    );
    expect(repository.markAsPublished).not.toHaveBeenCalled();
  });

  it('should share in-flight dispatch work across concurrent callers and allow subsequent runs', async () => {
    let resolveClaim!: (rows: []) => void;
    repository.claimNextBatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve;
      }),
    );
    const first = dispatcher.dispatchPending();
    const second = dispatcher.dispatchPending();
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
    resolveClaim([]);
    await Promise.all([first, second]);
    await dispatcher.dispatchPending();
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(2);
  });

  it('should clear in-flight state when claiming fails so a later dispatch can retry', async () => {
    const failure = new Error('Database unavailable');
    repository.claimNextBatch.mockRejectedValueOnce(failure);
    await expect(dispatcher.dispatchPending()).rejects.toBe(failure);
    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(2);
  });

  it('should calculate separate retention cutoffs for published and dead-lettered events', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T18:00:00Z'));
    await dispatcher.pruneExpiredEvents();
    expect(repository.pruneExpiredEvents).toHaveBeenCalledWith(
      new Date('2026-10-08T18:00:00Z'),
      new Date('2026-09-15T18:00:00Z'),
    );
  });

  it('should not start polling during ordinary unit tests', () => {
    dispatcher.onModuleInit();
    expect(repository.claimNextBatch).not.toHaveBeenCalled();
    expect(repository.pruneExpiredEvents).not.toHaveBeenCalled();
  });

  it('should poll and perform maintenance when realtime is enabled, then stop at shutdown', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T18:00:00Z'));
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'development' : false,
    );
    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(2);
    expect(repository.pruneExpiredEvents).toHaveBeenCalledTimes(1);
    await dispatcher.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(2);
  });
});
