# Matching delivery and recovery

PostgreSQL owns order, wallet and trade state. Creating an order reserves funds,
stores a `QUEUED` order and appends its matching intent in one transaction. The
API dispatches that intent to BullMQ using the order ID as the job ID, then
deletes the intent only after Redis acknowledges enqueueing. API and worker
processes also poll pending intents every two seconds.

## Delivery guarantees

- A Redis outage leaves the intent in PostgreSQL. Failed enqueue or intent
  acknowledgement schedules another attempt after two seconds. An abandoned
  claim becomes eligible after its 30-second lease expires. Restarting a process
  does not require clearing claims or changing reservations.
- A crash after enqueue but before intent deletion can enqueue the same ID
  again. BullMQ deduplicates retained jobs. Independently, matching locks the
  market and order and only processes `QUEUED` orders; replay after a committed
  fill, opening, rejection or cancellation does not settle again.
- A worker crash before matching commits rolls back wallet, order, trade and
  realtime-intent changes together. A crash after commit leaves those changes
  durable even if BullMQ has not marked the job completed. Another worker
  recovers the expired job through BullMQ's stalled-job detection and observes
  the committed status. Recovery uses BullMQ's normal lease/check intervals,
  so it is not immediate.
- Ordinary processing errors use three attempts with exponential backoff
  starting at one second. On the final attempt the processor tries to reject
  the still-`QUEUED` order and release its reservation transactionally. A
  successfully rejected order has a **completed** BullMQ job: completion means
  the processor handled the job, not necessarily that a trade occurred.
- If rejection itself fails, or BullMQ exhausts its stalled-job allowance, the
  job can remain **failed** while the order is still `QUEUED` with funds reserved.
  This needs operator review. The queue retains the most recent 100 completed
  and 100 failed jobs; it is not an audit log.

Both local worker concurrency and BullMQ global concurrency are `1`. Every
worker sets the shared global limit before consuming jobs, including when
several processes start together. PostgreSQL's BTC/USD transaction advisory
lock also serializes matching calls outside BullMQ. Keep both limits: raising
them is outside the current processing contract. This does not promise FIFO
acceptance across concurrent HTTP requests, outbox dispatchers or retries.
Eligible book makers are selected by price and then order sequence.

## Diagnose an order that remains QUEUED

Inspect the order, its reservation, matching intent (including `claimed_at`,
`next_attempt_at`, `attempt_count` and `last_error`), and BullMQ job with that
order ID. Use the same Redis host, port and queue name (`order-matching`) as the
application.

| State | Action |
| --- | --- |
| Intent exists; Redis unavailable or retry deadline/claim lease pending | Restore connectivity and allow dispatchers to retry. Do not reset reservations. |
| Job waiting, delayed or active | Restore workers and wait for processing, backoff or stalled recovery. Do not delete active jobs. |
| Job failed; order still `QUEUED` | Correct the underlying failure and retry that retained job with BullMQ `job.retry('failed')`. Re-enqueueing the same ID alone does not retry an existing failed job. |
| Job completed; order still `QUEUED` | Investigate the inconsistency. Once all consumers are stopped and the job is confirmed inactive, remove that retained job before restoring its intent. |
| No intent and no job; order still `QUEUED` | Follow the lost-job procedure below after confirming Redis job loss. |
| Order already `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED` or `REJECTED` | Do not restore a matching intent. Review its persisted state and history instead. |

## Recover confirmed lost jobs

The outbox guarantees delivery until enqueue acknowledgement; it does not
retain a second durable copy of acknowledged Redis jobs. Redis persistence,
backups and an appropriate eviction policy remain operational requirements.
There is no automatic periodic scan that recreates every `QUEUED` order's job.

1. Stop API and worker processes so the review and repair have a stable scope.
   Preserve PostgreSQL and existing Redis data. Confirm the affected orders are
   still `QUEUED` and review any retained failed/completed jobs as above. Never
   flush the queue to repair a single order.
2. Review the pending population with this read-only query:

   ```sql
   SELECT o.id, o.sequence, o.side, o.remaining_amount, o.price, o.created_at
   FROM orders o
   WHERE o.status = 'QUEUED'
     AND NOT EXISTS (
       SELECT 1 FROM order_matching_outbox b WHERE b.order_id = o.id
     )
   ORDER BY o.sequence;
   ```

3. Against the reviewed database, run
   [restore-matching-intents.sql](../backend/scripts/restore-matching-intents.sql)
   with a PostgreSQL client (for example `psql "$DATABASE_URL" -v ON_ERROR_STOP=1
   -f backend/scripts/restore-matching-intents.sql` from the repository root,
   using a libpq-compatible URL without Prisma's `schema` query parameter).
   The statement restores at most 100 missing intents in sequence order per
   invocation. It never changes balances or order status and skips orders
   already carrying an intent. Repeat until it inserts zero rows, then restart
   the application and monitor processing. If dispatchers are running, the
   affected-row count cannot be used to decide that the repair is complete.
4. Verify orders leave `QUEUED`, reservations agree with remaining active
   orders, and the reviewed intents drain. Investigate retained failed jobs
   separately. Repeating a batch while processes are stopped is safe; duplicate
   execution after processing also skips orders that have left `QUEUED`.

A user may cancel a still-active order through the API to release its remaining
reservation. Do not manually credit a wallet or change a queued order's status
as a substitute for transactional cancellation or rejection.

## Verification

From `backend`, with Docker and the installed backend dependencies:

```bash
npm run test:e2e:database -- --runTestsByPath test/matching-pipeline.e2e-spec.ts
```

The suite launches the real API and worker entrypoints as separate processes,
uses HTTP to create orders, and observes PostgreSQL/BullMQ results. It tests
price-time fills, fees and balances across two workers; completed-job replay;
a real Redis outage with API restart; failed enqueue acknowledgement; worker
`SIGKILL` before/after matching commit; transient rollback/retry; retry exhaustion
with BTC/USD reservation release; cancellation before delivery and replay; and
recovery of an acknowledged job lost from Redis.
Fault triggers and advisory gates exist only in the runner's dedicated database
and are removed on teardown. BullMQ timers, application providers and matching
processors are not replaced. CI's existing database E2E job discovers this suite
automatically. Allow several minutes for the real lease and stalled-job tests.
