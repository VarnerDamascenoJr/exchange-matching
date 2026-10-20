import { Prisma } from '@prisma/client';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
import { RealtimeOutboxService } from './realtime-outbox.service';
import { RealtimeDispatchEvent } from './realtime.types';

describe('RealtimeOutboxService', () => {
  let service: RealtimeOutboxService;
  let repository: jest.Mocked<RealtimeOutboxRepository>;
  const transactionClient = {} as Prisma.TransactionClient;
  const event: RealtimeDispatchEvent = {
    type: 'account.changed',
    reason: 'order-created',
    userId: 'user-1',
    occurredAt: '2026-10-15T18:00:00Z',
  };

  beforeEach(() => {
    repository = {
      insertEvents: jest.fn(),
    } as unknown as jest.Mocked<RealtimeOutboxRepository>;
    service = new RealtimeOutboxService(repository);
  });

  it('should serialize a single event and preserve the caller’s transaction', async () => {
    await service.appendEvent(transactionClient, event);
    expect(repository.insertEvents).toHaveBeenCalledWith(
      [
        {
          id: expect.stringMatching(/^evt_/),
          eventType: event.type,
          payload: JSON.stringify(event),
        },
      ],
      transactionClient,
    );
  });

  it('should serialize all events and assign distinct IDs in one batch', async () => {
    const marketEvent: RealtimeDispatchEvent = {
      type: 'market.changed',
      reason: 'order-opened',
      occurredAt: event.occurredAt,
    };
    await service.appendEvents(transactionClient, [event, marketEvent]);
    expect(repository.insertEvents).toHaveBeenCalledTimes(1);
    const [entries, client] = repository.insertEvents.mock.calls[0];
    expect(client).toBe(transactionClient);
    expect(
      entries.map(
        (entry) => JSON.parse(entry.payload) as RealtimeDispatchEvent,
      ),
    ).toEqual([event, marketEvent]);
    expect(entries.map((entry) => entry.eventType)).toEqual([
      'account.changed',
      'market.changed',
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('should store immediate events without requesting a transaction client', async () => {
    await service.appendNow([event]);
    expect(repository.insertEvents).toHaveBeenCalledWith([
      {
        id: expect.stringMatching(/^evt_/),
        eventType: event.type,
        payload: JSON.stringify(event),
      },
    ]);
  });

  it('should skip empty batches for both transactional and immediate appends', async () => {
    await service.appendEvents(transactionClient, []);
    await service.appendNow([]);
    expect(repository.insertEvents).not.toHaveBeenCalled();
  });

  it('should propagate persistence failures to the caller', async () => {
    const failure = new Error('Outbox unavailable');
    repository.insertEvents.mockRejectedValueOnce(failure);
    await expect(service.appendEvent(transactionClient, event)).rejects.toBe(
      failure,
    );
  });
});
