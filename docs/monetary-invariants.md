# Monetary invariants and reproducible sequences

The [decimal policy](decimal-policy.md) defines settlement and rounding. The
[sequence suite](../backend/test/monetary-invariants.e2e-spec.ts) checks those
rules against persisted PostgreSQL state after each completed operation, using
the real order, matching and wallet services. Concurrent operations are checked
after both transactions settle; their unchanged committed state is also checked
while an external row lock holds them pending.

Only the matching/realtime dispatchers are replaced to control when orders are
processed. Their transactional outbox writes remain real. Delivery and worker
recovery are covered separately by the [pipeline suite](matching-recovery.md).

## Independent ledger

The [test oracle](../backend/test/support/monetary-invariants.ts) imports no
production arithmetic, fee or settlement helpers. It converts stored decimal
strings to `BigInt` units of `0.00000001`; no monetary value passes through a
JavaScript `Number`. For nonnegative operands, integer division implements
rounding down:

```text
cost(amount, price) = (amountUnits * priceUnits) / 100000000
makerFee = receivedAssetUnits * 5 / 1000
takerFee = receivedAssetUnits * 3 / 1000
```

For every snapshot it verifies:

- Each available/reserved wallet component is nonnegative and fits
  `DECIMAL(28,8)`.
- Every fill has positive BTC and positive quantized USD consideration, uses
  the maker price within both limit prices, references opposing orders and
  distinct users, and records the correct fee rate, asset and rounded amount.
- An order's original amount minus its remaining amount equals all its fills.
  Filled, unexecuted and partially filled statuses agree with those quantities.
- Per user, reserved BTC equals the remaining quantities of active SELL orders.
  Reserved USD equals the **sum of each active BUY order's individually rounded
  remaining limit cost**, including `QUEUED` orders. Cancelled/rejected/filled
  orders contribute no reservation.
- Each user's total BTC equals its opening BTC, plus bought quantities, minus
  sold quantities and BTC fees. Its total USD equals opening USD, plus per-fill
  sale costs, minus per-fill purchase costs and USD fees. Available balances
  equal these expected totals minus that user's required reservations.
- Across all users, available plus reserved balances plus recorded fees equal
  the opening totals separately for BTC and USD. Fees are outside user wallets;
  rounding refunds stay with the buyer and are not treated as fees.

The per-user ledger catches misdirected credits even when global conservation
still holds. Costs are rounded **per fill**, never after aggregation. Positive
BUY dust may legitimately require zero USD reservation, but it must not produce
a zero-cost trade; cancellation then releases zero.

The [oracle regression suite](../backend/test/monetary-oracle.e2e-spec.ts) uses
independently specified ledgers for both taker sides. Corruptions deliberately
introduce one-unit balance/reservation/fee errors, wrong fee rates/assets,
negative/overflowing balances, zero-cost fills, inconsistent order quantities,
duplicate fill identities and a wrong transfer that preserves global totals.
Each must be rejected by the oracle. These checks run without PostgreSQL too.

## Sequences and concurrency

Deterministic scenarios exercise multiple makers, price improvement, eight-place
rounding, the minimum BTC/USD units, zero rounded fees, zero-cost residuals,
large values beyond safe JavaScript integers, failed reservations and rejection.
A test-only database trigger fails the second fill after the first fill's writes
have run. The whole monetary snapshot and realtime intents must roll back; retry
then settles once and concurrent replay leaves the settled snapshot unchanged.
The trigger is removed in teardown.

Cancellation/matching races cover both taker sides and both winners. An external
PostgreSQL row lock establishes the first waiter; the test observes direct and
transitive blockers through `pg_blocking_pids` before releasing it. It checks the
persisted maker choice, partial cancellation refunds and the complete ledger.
A separate duplicate-cancellation race proves that a reservation is released
only once. Wall-clock sleeps do not decide which transaction wins.

Generated sequences run 64 steps for each of four fixed seeds (`1`,
`1592594996`, `12648430`, `4294967295`). Commands create, process, cancel, reject
and replay orders, with invariants checked after every step and unchanged state
required after rejected requests/replay. Queued orders are drained and active
orders cancelled at the end, requiring all reservations to be zero. Commands
select orders in database sequence order; random IDs do not determine the
generated actions. Failure output includes the seed, command trace and assertion
cause. The seed generator uses numbers only to select commands and fixture
strings, never to calculate money.

## Run and reproduce

From `backend`, with the dependencies installed and Docker available:

```bash
npm run test:e2e:database -- --runTestsByPath test/monetary-invariants.e2e-spec.ts test/monetary-oracle.e2e-spec.ts
```

Run one generated sequence, using the unsigned 32-bit seed printed in a failure:

```bash
INVARIANT_SEED=1 npm run test:e2e:database -- --runTestsByPath test/monetary-invariants.e2e-spec.ts --testNamePattern 'generated operation'
```

Run just the oracle regression checks without database access:

```bash
RUN_DATABASE_E2E=false NODE_ENV=test npm run test:e2e -- --runInBand --runTestsByPath test/monetary-oracle.e2e-spec.ts
```

The existing CI database E2E job discovers both suites automatically and uses
the same isolated runner. These sequences verify current operations on clean
fixtures; they do not reconcile legacy account data or exhaustively enumerate
all possible schedules and inputs.
