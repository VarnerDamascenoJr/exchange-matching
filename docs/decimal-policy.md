# Decimal and settlement policy

The backend is authoritative. Financial request/response values are decimal strings; do not convert them through JavaScript `Number` or `parseFloat`. Display formatting does not change order inputs.

## Scale, limits and calculation

- Amounts, prices and balances use `DECIMAL(28,8)`: at most 20 integer digits and eight fractional digits, up to `99999999999999999999.99999999`. Leading zeros do not consume precision. Inputs outside these numeric limits are rejected rather than rounded into range.
- Arithmetic uses a private Decimal constructor with 56 significant digits, enough for the exact product of two storage-sized operands. The global Prisma/Decimal configuration is unchanged.
- Costs, fees and balance differences are quantized to eight decimal places with `ROUND_DOWN` (toward zero). All monetary operands are nonnegative. Calculated values outside the storage range are rejected before writing them.
- The frontend uses the same arithmetic policy for its total estimate and mirrors input/cost bounds. Backend validation always runs, including for requests that bypass the form.

Both test suites consume [the same reference cases](../shared/decimal-cases.json), including `0.5 × 0.00000001 = 0.00000000`, `0.1 × 0.33333333 = 0.03333333`, the minimum unit and large products. Storage limits and rounding follow [PostgreSQL numeric](https://www.postgresql.org/docs/current/datatype-numeric.html) and the explicit configuration of [Decimal arithmetic](https://mikemcl.github.io/decimal.js/).

## Minimum order cost and zero-cost fragments

The minimum input amount is `0.00000001 BTC`, and the minimum price is `0.00000001 USD`. Additionally, **both BUY and SELL orders must have a quantized limit cost of at least `0.00000001 USD`**. Zero-cost and overflowing orders return HTTP 400 before opening an order transaction, reserving funds or storing outbox events.

Matching uses the maker price. A candidate fragment can be worth zero even when its orders originally passed validation, because of price improvement or partial execution. Such a candidate is skipped without transferring BTC/USD, charging fees or creating a trade. Price/time priority remains unchanged among executable candidates. A skipped order or residual remains OPEN/PARTIALLY_FILLED, retains its original remaining quantity and can be cancelled. There is no automatic dust cancellation.

Each actual fill must have positive BTC and positive quantized USD consideration. Fees are still calculated per fill on the received asset (maker 0.5%, taker 0.3%) and rounded down. A zero **fee** is valid for a small positive-cost fill.

## Partial fills, reservations and refunds

A BUY order reserves `floor8(remainingAmount × limitPrice)` USD. For a fill of quantity `q` from a current remainder `a`, its reservation debit is:

```text
floor8(a × limitPrice) − floor8((a − q) × limitPrice)
```

The buyer pays `floor8(q × makerPrice)` USD. Any excess debit is credited to available USD, including both price improvement and a possible quantization surplus. This applies to BUY makers and BUY takers; takers use their updated remainder for each successive maker. A SELL reservation is its exact remaining BTC amount.

This keeps reservations equal to the remaining order cost after every fill. Cancellation/rejection releases exactly the remaining reservation, including zero for a BUY dust remainder. Per-fill costs are not replaced by a rounded aggregate cost, and rounding surpluses are not collected as fees.

Balance writes atomically require sufficient debited balances and enough numeric capacity for credits. A failed condition produces a validation error (or a failed reservation) and the enclosing transaction rolls back; no partially settled trade persists.

This change does not migrate or reconcile legacy wallet balances/reservations already affected by the previous rounding rules. Existing inconsistent data requires a separate reconciliation before reuse.
