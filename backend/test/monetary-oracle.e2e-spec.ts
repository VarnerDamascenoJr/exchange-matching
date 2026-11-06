import {
  assertMonetaryInvariants,
  MonetaryState,
  units,
} from './support/monetary-invariants';

const opening = ['buyer', 'seller'].map((userId) => ({
  userId,
  btc: '100',
  usd: '100000',
}));

function settled(takerSide: 'BUY' | 'SELL' = 'BUY'): MonetaryState {
  return {
    wallets: [
      {
        userId: 'buyer',
        availableBtc: takerSide === 'BUY' ? '100.997' : '100.995',
        reservedBtc: '0',
        availableUsd: '90000',
        reservedUsd: '0',
      },
      {
        userId: 'seller',
        availableBtc: '99',
        reservedBtc: '0',
        availableUsd: takerSide === 'BUY' ? '109950' : '109970',
        reservedUsd: '0',
      },
    ],
    orders: (['BUY', 'SELL'] as const).map((side) => ({
      id: side,
      userId: side === 'BUY' ? 'buyer' : 'seller',
      side,
      status: 'FILLED',
      price: '10000',
      originalAmount: '1',
      remainingAmount: '0',
    })),
    trades: [
      {
        id: 'fill',
        makerOrderId: takerSide === 'BUY' ? 'SELL' : 'BUY',
        takerOrderId: takerSide,
        buyOrderId: 'BUY',
        sellOrderId: 'SELL',
        takerSide,
        price: '10000',
        amount: '1',
        makerFeeRate: '0.005',
        makerFeeAmount: takerSide === 'BUY' ? '50' : '0.005',
        makerFeeAsset: takerSide === 'BUY' ? 'USD' : 'BTC',
        takerFeeRate: '0.003',
        takerFeeAmount: takerSide === 'BUY' ? '0.003' : '30',
        takerFeeAsset: takerSide === 'BUY' ? 'BTC' : 'USD',
      },
    ],
  };
}

// These checks always run, including ordinary E2E runs without a database.
describe('Independent monetary oracle regression checks', () => {
  it.each(['BUY', 'SELL'] as const)(
    'accepts an independently specified %s taker ledger',
    (side) => {
      expect(assertMonetaryInvariants(settled(side), opening)).toEqual({
        btcFees: units(side === 'BUY' ? '0.003' : '0.005'),
        usdFees: units(side === 'BUY' ? '50' : '30'),
      });
    },
  );

  const corruptions: [string, (state: MonetaryState) => void, RegExp][] = [
    [
      'a one-unit credit error',
      (s) => (s.wallets[0].availableBtc = '100.99700001'),
      /BTC ledger/,
    ],
    [
      'an unreleased USD reservation',
      (s) => (s.wallets[0].reservedUsd = '0.00000001'),
      /USD reservation/,
    ],
    [
      'an unreleased BTC reservation',
      (s) => (s.wallets[1].reservedBtc = '0.00000001'),
      /BTC reservation/,
    ],
    [
      'a negative balance',
      (s) => (s.wallets[0].availableUsd = '-0.00000001'),
      /nonnegative storage bounds/,
    ],
    [
      'an overflowing balance',
      (s) => (s.wallets[0].availableUsd = '100000000000000000000'),
      /nonnegative storage bounds/,
    ],
    [
      'an incorrect fee asset',
      (s) => (s.trades[0].makerFeeAsset = 'BTC'),
      /maker fee asset/,
    ],
    [
      'a one-unit fee error',
      (s) => (s.trades[0].makerFeeAmount = '50.00000001'),
      /maker fee amount/,
    ],
    [
      'an incorrect fee rate',
      (s) => (s.trades[0].takerFeeRate = '0.005'),
      /taker fee rate/,
    ],
    [
      'zero-cost consideration',
      (s) => {
        s.trades[0].amount = '0.00000001';
        s.trades[0].price = '0.00000001';
      },
      /positive consideration/,
    ],
    [
      'an inconsistent remaining amount',
      (s) => (s.orders[0].remainingAmount = '0.1'),
      /order BUY/,
    ],
    [
      'a wrong terminal status',
      (s) => (s.orders[0].status = 'OPEN'),
      /remaining amount/,
    ],
    [
      'a duplicate fill identity',
      (s) => s.trades.push({ ...s.trades[0] }),
      /unique trades/,
    ],
    [
      'a transfer between users that preserves global USD',
      (s) => {
        s.wallets[0].availableUsd = '90001';
        s.wallets[1].availableUsd = '109949';
      },
      /USD ledger/,
    ],
  ];

  it.each(corruptions)('rejects %s', (_name, corrupt, expected) => {
    const state = settled();
    corrupt(state);
    expect(() => assertMonetaryInvariants(state, opening)).toThrow(expected);
  });

  it('keeps integer precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(units('99999999999999999999.99999999')).toBe(10n ** 28n - 1n);
    expect(units('0.00000001')).toBe(1n);
    expect(() => units('1.000000001')).toThrow('Invalid eight-place decimal');
  });
});
