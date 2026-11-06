import assert from 'node:assert/strict';

// An independent ledger oracle: no production arithmetic or settlement imports.
const SCALE = 100_000_000n;
const MAX = 10n ** 28n - 1n;
type Side = 'BUY' | 'SELL';
type Asset = 'BTC' | 'USD';
type Status =
  'QUEUED' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export type MonetaryState = {
  wallets: {
    userId: string;
    availableBtc: string;
    reservedBtc: string;
    availableUsd: string;
    reservedUsd: string;
  }[];
  orders: {
    id: string;
    userId: string;
    side: Side;
    status: Status;
    price: string;
    originalAmount: string;
    remainingAmount: string;
  }[];
  trades: {
    id: string;
    makerOrderId: string;
    takerOrderId: string;
    buyOrderId: string;
    sellOrderId: string;
    takerSide: Side;
    price: string;
    amount: string;
    makerFeeRate: string;
    makerFeeAmount: string;
    makerFeeAsset: Asset;
    takerFeeRate: string;
    takerFeeAmount: string;
    takerFeeAsset: Asset;
  }[];
};

export type OpeningBalance = { userId: string; btc: string; usd: string };

export function units(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  assert(match, `Invalid eight-place decimal: ${value}`);
  const magnitude =
    BigInt(match[2]) * SCALE + BigInt((match[3] ?? '').padEnd(8, '0'));
  return match[1] ? -magnitude : magnitude;
}

const cost = (amount: bigint, price: bigint) => (amount * price) / SCALE;
const active = new Set<Status>(['QUEUED', 'OPEN', 'PARTIALLY_FILLED']);

function bounded(value: string, label: string): bigint {
  const result = units(value);
  assert(result >= 0n && result <= MAX, `${label}: nonnegative storage bounds`);
  return result;
}

export function assertMonetaryInvariants(
  state: MonetaryState,
  opening: readonly OpeningBalance[],
): { btcFees: bigint; usdFees: bigint } {
  const ledger = new Map(
    opening.map((balance) => [
      balance.userId,
      {
        btc: units(balance.btc),
        usd: units(balance.usd),
        reservedBtc: 0n,
        reservedUsd: 0n,
      },
    ]),
  );
  assert.equal(ledger.size, opening.length, 'unique opening accounts');
  assert.equal(state.wallets.length, opening.length, 'wallet population');
  assert.equal(new Set(state.wallets.map((w) => w.userId)).size, ledger.size);
  const orders = new Map(state.orders.map((order) => [order.id, order]));
  assert.equal(orders.size, state.orders.length, 'unique orders');
  assert.equal(
    new Set(state.trades.map((t) => t.id)).size,
    state.trades.length,
    'unique trades',
  );
  const executed = new Map<string, bigint>();
  let btcFees = 0n;
  let usdFees = 0n;

  for (const trade of state.trades) {
    const label = `trade ${trade.id}`;
    const maker = orders.get(trade.makerOrderId);
    const taker = orders.get(trade.takerOrderId);
    const buy = orders.get(trade.buyOrderId);
    const sell = orders.get(trade.sellOrderId);
    assert(maker && taker && buy && sell, `${label}: referenced orders`);
    assert.notEqual(maker.userId, taker.userId, `${label}: self trade`);
    assert.notEqual(maker.side, taker.side, `${label}: opposing sides`);
    assert.equal(buy.side, 'BUY', `${label}: buyer side`);
    assert.equal(sell.side, 'SELL', `${label}: seller side`);
    assert.equal(trade.takerSide, taker.side, `${label}: taker side`);
    assert.equal(buy.id, maker.side === 'BUY' ? maker.id : taker.id);
    assert.equal(sell.id, maker.side === 'SELL' ? maker.id : taker.id);
    const amount = bounded(trade.amount, label);
    const price = bounded(trade.price, label);
    const consideration = cost(amount, price);
    assert(
      amount > 0n && consideration > 0n,
      `${label}: positive consideration`,
    );
    assert.equal(price, units(maker.price), `${label}: maker price`);
    assert(price <= units(buy.price) && price >= units(sell.price), label);
    const buyer = ledger.get(buy.userId);
    const seller = ledger.get(sell.userId);
    assert(buyer && seller, `${label}: account exists`);
    buyer.btc += amount;
    buyer.usd -= consideration;
    seller.btc -= amount;
    seller.usd += consideration;

    for (const role of ['maker', 'taker'] as const) {
      const order = role === 'maker' ? maker : taker;
      const asset = order.side === 'BUY' ? 'BTC' : 'USD';
      const rate = role === 'maker' ? 5n : 3n;
      const gross = asset === 'BTC' ? amount : consideration;
      const fee = bounded(
        role === 'maker' ? trade.makerFeeAmount : trade.takerFeeAmount,
        `${label} ${role} fee`,
      );
      assert.equal(
        role === 'maker' ? trade.makerFeeAsset : trade.takerFeeAsset,
        asset,
        `${label} ${role} fee asset`,
      );
      assert.equal(
        units(role === 'maker' ? trade.makerFeeRate : trade.takerFeeRate),
        (rate * SCALE) / 1000n,
        `${label} ${role} fee rate`,
      );
      assert.equal(fee, (gross * rate) / 1000n, `${label} ${role} fee amount`);
      const account = asset === 'BTC' ? buyer : seller;
      if (asset === 'BTC') {
        account.btc -= fee;
        btcFees += fee;
      } else {
        account.usd -= fee;
        usdFees += fee;
      }
    }
    for (const order of [maker, taker]) {
      executed.set(order.id, (executed.get(order.id) ?? 0n) + amount);
    }
  }

  for (const order of state.orders) {
    const label = `order ${order.id}`;
    const original = bounded(order.originalAmount, label);
    const remaining = bounded(order.remainingAmount, label);
    const price = bounded(order.price, label);
    const originalCost = cost(original, price);
    assert(
      original > 0n && originalCost > 0n && originalCost <= MAX,
      `${label}: valid input`,
    );
    assert.equal(original - remaining, executed.get(order.id) ?? 0n, label);
    if (order.status === 'FILLED') assert.equal(remaining, 0n, label);
    else assert(remaining > 0n, `${label}: remaining amount`);
    if (order.status === 'PARTIALLY_FILLED')
      assert(remaining < original, label);
    if (['QUEUED', 'OPEN', 'REJECTED'].includes(order.status)) {
      assert.equal(remaining, original, `${label}: unexecuted status`);
    }
    const account = ledger.get(order.userId);
    assert(account, `${label}: account exists`);
    if (active.has(order.status)) {
      if (order.side === 'BUY') account.reservedUsd += cost(remaining, price);
      else account.reservedBtc += remaining;
    }
  }

  let totalBtc = btcFees;
  let totalUsd = usdFees;
  for (const wallet of state.wallets) {
    const label = `wallet ${wallet.userId}`;
    const account = ledger.get(wallet.userId);
    assert(account, `${label}: opening account exists`);
    const availableBtc = bounded(wallet.availableBtc, label);
    const availableUsd = bounded(wallet.availableUsd, label);
    const reservedBtc = bounded(wallet.reservedBtc, label);
    const reservedUsd = bounded(wallet.reservedUsd, label);
    assert.equal(reservedBtc, account.reservedBtc, `${label}: BTC reservation`);
    assert.equal(reservedUsd, account.reservedUsd, `${label}: USD reservation`);
    assert.equal(
      availableBtc,
      account.btc - reservedBtc,
      `${label}: BTC ledger`,
    );
    assert.equal(
      availableUsd,
      account.usd - reservedUsd,
      `${label}: USD ledger`,
    );
    totalBtc += availableBtc + reservedBtc;
    totalUsd += availableUsd + reservedUsd;
  }
  assert.equal(
    totalBtc,
    opening.reduce((sum, balance) => sum + units(balance.btc), 0n),
    'global BTC conservation including fees',
  );
  assert.equal(
    totalUsd,
    opening.reduce((sum, balance) => sum + units(balance.usd), 0n),
    'global USD conservation including fees',
  );
  return { btcFees, usdFees };
}
