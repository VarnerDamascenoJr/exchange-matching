import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAuthSession,
  getStoredAuthState,
  storeAuthState,
} from './session-storage';

describe('session storage', () => {
  afterEach(() => {
    clearAuthSession();
  });

  it('stores and reads token-only auth state', () => {
    storeAuthState({ accessToken: 'token-123' });

    expect(getStoredAuthState()).toEqual({ accessToken: 'token-123' });
  });

  it('reads legacy full-session payloads as token-only state', () => {
    window.localStorage.setItem(
      'wisiex.auth-session',
      JSON.stringify({
        accessToken: 'legacy-token',
        user: { id: 'user-1', username: 'alice' },
        wallet: {
          availableBtc: '1.0',
          reservedBtc: '0.1',
          availableUsd: '1000',
          reservedUsd: '50',
        },
      }),
    );

    expect(getStoredAuthState()).toEqual({ accessToken: 'legacy-token' });
  });
});
