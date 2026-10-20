import { toUserProfile } from './user.mapper';

describe('toUserProfile', () => {
  it('should map the public ID and username', () => {
    expect(toUserProfile({ id: 'user-1', username: 'alice' })).toEqual({
      id: 'user-1',
      username: 'alice',
    });
  });

  it('should exclude wallet balances, dates and other internal fields', () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      createdAt: new Date(),
      updatedAt: new Date(),
      wallet: { id: 'wallet-1', availableBtc: '100', availableUsd: '100000' },
    };
    expect(toUserProfile(user)).toEqual({ id: 'user-1', username: 'alice' });
  });

  it('should preserve the stored username rather than normalizing it in the mapper', () => {
    expect(toUserProfile({ id: 'user-2', username: 'Álice_Trader' })).toEqual({
      id: 'user-2',
      username: 'Álice_Trader',
    });
  });
});
