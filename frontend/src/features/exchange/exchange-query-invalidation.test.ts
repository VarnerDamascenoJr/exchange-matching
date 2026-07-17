import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../app/query-keys';
import { invalidateExchangeQueries } from './exchange-query-invalidation';

describe('invalidateExchangeQueries', () => {
  it('invalidates only market queries for the market scope', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateExchangeQueries(
      { invalidateQueries } as never,
      'market',
    );

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: queryKeys.marketStats,
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: queryKeys.marketMatchesRoot,
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: queryKeys.orderBookRoot,
    });
  });

  it('invalidates account queries for the account scope', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateExchangeQueries(
      { invalidateQueries } as never,
      'account',
    );

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: queryKeys.me,
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: queryKeys.wallet,
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: queryKeys.activeOrdersRoot,
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(4, {
      queryKey: queryKeys.tradeHistoryRoot,
    });
  });
});
