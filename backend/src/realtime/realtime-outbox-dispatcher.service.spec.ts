import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
import { RealtimePublisherService } from './realtime.publisher';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';
import { RealtimeDispatchEvent } from './realtime.types';
import {
  REALTIME_OUTBOX_BATCH_SIZE,
  REALTIME_OUTBOX_CLAIM_TIMEOUT_SECONDS,
  REALTIME_OUTBOX_MAX_ATTEMPTS,
  REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
  REALTIME_OUTBOX_POLL_INTERVAL_MS,
  REALTIME_OUTBOX_RETRY_DELAY_MS,
  REALTIME_OUTBOX_MAINTENANCE_INTERVAL_MS,
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
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    repository = {
      claimNextBatch: jest.fn().mockResolvedValue([]),
      markAsPublished: jest.fn(),
      releaseClaim: jest.fn(),
      pruneExpiredEvents: jest.fn().mockResolvedValue(undefined),
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
      REALTIME_OUTBOX_RETRY_DELAY_MS,
      REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
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
      REALTIME_OUTBOX_RETRY_DELAY_MS,
      REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
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

  it('waits for the durable retry deadline instead of burning attempts during an outage', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T18:00:00Z'));
    config.get.mockReturnValue('development');
    let nextAttemptAt = 0;
    repository.claimNextBatch.mockImplementation(() =>
      Promise.resolve(
        Date.now() >= nextAttemptAt
          ? [{ id: 'event-1', claim_token: 'claim-1', payload: event }]
          : [],
      ),
    );
    repository.releaseClaim.mockImplementation(
      (_id, _token, _error, _maxAttempts, delay) => {
        nextAttemptAt = Date.now() + delay;
        return Promise.resolve();
      },
    );
    repository.markAsPublished.mockImplementation(() => {
      nextAttemptAt = Infinity;
      return Promise.resolve();
    });
    publisher.publishEvent.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );

    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
    expect(publisher.publishEvent).toHaveBeenCalledTimes(1);
    await dispatcher.dispatchPending();
    await dispatcher.dispatchPending();
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_RETRY_DELAY_MS - 1);
    expect(publisher.publishEvent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(repository.releaseClaim).toHaveBeenCalledTimes(1);
    expect(repository.markAsPublished).toHaveBeenCalledTimes(1);
  });

  it('handles claim failures at startup and on a timer, then resumes polling', async () => {
    jest.useFakeTimers();
    config.get.mockReturnValue('development');
    repository.claimNextBatch
      .mockRejectedValueOnce(new Error('Startup database failure'))
      .mockRejectedValueOnce(new Error('Polling database failure'));
    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Startup database failure'),
      expect.any(String),
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Polling database failure'),
      expect.any(String),
    );
  });

  it('retains a failed acknowledgement for retry and still delivers the rest of the batch', async () => {
    repository.claimNextBatch.mockResolvedValueOnce([
      { id: 'event-1', claim_token: 'claim-1', payload: event },
      { id: 'event-2', claim_token: 'claim-1', payload: event },
    ]);
    repository.markAsPublished.mockRejectedValueOnce(
      new Error('Acknowledgement failed'),
    );
    await dispatcher.dispatchPending();
    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(repository.releaseClaim).toHaveBeenCalledWith(
      'event-1',
      'claim-1',
      'Acknowledgement failed',
      REALTIME_OUTBOX_MAX_ATTEMPTS,
      REALTIME_OUTBOX_RETRY_DELAY_MS,
      REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
    );
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
  });

  it('logs a failed claim release without abandoning later events or spinning', async () => {
    repository.claimNextBatch.mockResolvedValueOnce([
      { id: 'event-1', claim_token: 'claim-1', payload: event },
      { id: 'event-2', claim_token: 'claim-1', payload: event },
    ]);
    publisher.publishEvent.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );
    repository.releaseClaim.mockRejectedValueOnce(
      new Error('Release database failure'),
    );
    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();
    expect(repository.markAsPublished).toHaveBeenCalledWith(
      'event-2',
      'claim-1',
    );
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Failed to release realtime claim event-1'),
      expect.any(String),
    );
  });

  it('retries failed maintenance at the next poll, then restores its normal interval', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T18:00:00Z'));
    config.get.mockReturnValue('development');
    repository.pruneExpiredEvents.mockRejectedValueOnce(
      new Error('Pruning database failure'),
    );
    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Pruning database failure'),
      expect.any(String),
    );
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.pruneExpiredEvents).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.pruneExpiredEvents).toHaveBeenCalledTimes(2);
    jest.setSystemTime(Date.now() + REALTIME_OUTBOX_MAINTENANCE_INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.pruneExpiredEvents).toHaveBeenCalledTimes(3);
  });

  it('drains the claimed batch and maintenance before module destruction, without starting another batch', async () => {
    jest.useFakeTimers();
    config.get.mockReturnValue('development');
    let resolveClaim!: (
      rows: {
        id: string;
        claim_token: string;
        payload: RealtimeDispatchEvent;
      }[],
    ) => void;
    let resolveMaintenance!: () => void;
    repository.claimNextBatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve;
      }),
    );
    repository.pruneExpiredEvents.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMaintenance = resolve;
      }),
    );
    dispatcher.onModuleInit();
    const activeDispatch = dispatcher.dispatchPending();
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS * 2);
    let stopped = false;
    const shutdown = dispatcher.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    const waitedForDispatch = !stopped;
    resolveClaim([
      { id: 'event-1', claim_token: 'claim-1', payload: event },
      { id: 'event-2', claim_token: 'claim-1', payload: event },
    ]);
    await activeDispatch;
    const waitedForMaintenance = !stopped;
    resolveMaintenance();
    await shutdown;
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    await dispatcher.dispatchPending();
    await dispatcher.pruneExpiredEvents();
    dispatcher.onModuleInit();
    expect(waitedForDispatch).toBe(true);
    expect(waitedForMaintenance).toBe(true);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
    expect(repository.pruneExpiredEvents).toHaveBeenCalledTimes(1);
    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles shutdown safely even if the in-flight claim rejects', async () => {
    let rejectClaim!: (error: Error) => void;
    repository.claimNextBatch.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectClaim = reject;
      }),
    );
    const dispatch = dispatcher.dispatchPending().catch(() => {});
    const shutdown = dispatcher.onApplicationShutdown();
    rejectClaim(new Error('Database stopped during dispatch'));
    await Promise.all([dispatch, shutdown]);
    await dispatcher.dispatchPending();
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Failed to finish realtime dispatch at shutdown'),
      expect.any(String),
    );
  });
  function enablePolling() {
    jest.useFakeTimers();
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'development' : false,
    );
    return errorLog;
  }

  it.each(['startup', 'poll'] as const)(
    'logs a %s claim failure and publishes again on the next poll',
    async (phase) => {
      const loggedError = enablePolling();
      const failure = new Error('Database unavailable');
      if (phase === 'poll') {
        repository.claimNextBatch.mockResolvedValueOnce([]);
      }
      repository.claimNextBatch
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce([
          { id: 'event-1', claim_token: 'claim-1', payload: event },
        ]);

      dispatcher.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      if (phase === 'poll') {
        await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
      }

      expect(loggedError).toHaveBeenCalledTimes(1);
      expect(loggedError).toHaveBeenCalledWith(
        'Realtime outbox dispatch failed: Database unavailable',
        failure.stack,
      );
      expect(publisher.publishEvent).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);

      expect(publisher.publishEvent).toHaveBeenCalledWith(event);
      expect(repository.markAsPublished).toHaveBeenCalledWith(
        'event-1',
        'claim-1',
      );
      expect(loggedError).toHaveBeenCalledTimes(1);
    },
  );

  it('contains a failed claim release and resumes publishing other pending events', async () => {
    const loggedError = enablePolling();
    const failure = new Error('Database unavailable during claim release');
    repository.claimNextBatch
      .mockResolvedValueOnce([
        { id: 'event-1', claim_token: 'claim-1', payload: event },
      ])
      .mockResolvedValueOnce([
        { id: 'event-2', claim_token: 'claim-2', payload: event },
      ]);
    publisher.publishEvent.mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );
    repository.releaseClaim.mockRejectedValueOnce(failure);

    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    expect(loggedError).toHaveBeenCalledWith(
      'Failed to release realtime claim event-1; its lease must expire before retry: Database unavailable during claim release',
      failure.stack,
    );

    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);

    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(repository.markAsPublished).toHaveBeenCalledWith(
      'event-2',
      'claim-2',
    );
    expect(repository.releaseClaim).toHaveBeenCalledTimes(1);
  });

  it('does not overlap slow dispatches or log the same failure on every tick', async () => {
    const loggedError = enablePolling();
    const failure = new Error('Slow database request failed');
    let rejectClaim!: (error: Error) => void;
    repository.claimNextBatch.mockReturnValueOnce(
      new Promise<never>((_, reject) => {
        rejectClaim = reject;
      }),
    );

    dispatcher.onModuleInit();
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS * 2);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);

    rejectClaim(failure);
    await jest.advanceTimersByTimeAsync(0);
    expect(loggedError).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(2);
    expect(loggedError).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight failure during shutdown and stops polling', async () => {
    const loggedError = enablePolling();
    let rejectClaim!: (error: Error) => void;
    repository.claimNextBatch.mockReturnValueOnce(
      new Promise<never>((_, reject) => {
        rejectClaim = reject;
      }),
    );

    dispatcher.onModuleInit();
    const shutdown = dispatcher.onApplicationShutdown();
    rejectClaim(new Error('Database unavailable during shutdown'));

    await expect(shutdown).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(REALTIME_OUTBOX_POLL_INTERVAL_MS);
    expect(loggedError).toHaveBeenCalledTimes(1);
    expect(repository.claimNextBatch).toHaveBeenCalledTimes(1);
  });
});
