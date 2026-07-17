import { useQueryClient } from '@tanstack/react-query';
import { PropsWithChildren, useCallback, useMemo, useState } from 'react';
import { queryKeys } from '../../../app/query-keys';
import {
  clearAuthSession,
  getStoredAuthState,
  storeAuthState,
} from '../../../services/session-storage';
import type { AuthContextValue, AuthSession, StoredAuthState } from '../../../types/auth';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState<StoredAuthState | null>(() =>
    getStoredAuthState(),
  );

  const login = useCallback(
    (nextSession: AuthSession) => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, nextSession.user);
      queryClient.setQueryData(queryKeys.wallet, nextSession.wallet);

      const nextAuthState = {
        accessToken: nextSession.accessToken,
      };

      storeAuthState(nextAuthState);
      setAuthState(nextAuthState);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    queryClient.clear();
    clearAuthSession();
    setAuthState(null);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: authState?.accessToken ?? null,
      isAuthenticated: Boolean(authState?.accessToken),
      login,
      logout,
    }),
    [authState?.accessToken, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
