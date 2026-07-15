import { useQueryClient } from '@tanstack/react-query';
import { PropsWithChildren, useCallback, useMemo, useState } from 'react';
import {
  clearAuthSession,
  getStoredAuthSession,
  storeAuthSession,
} from '../../../services/session-storage';
import type { AuthContextValue, AuthSession } from '../../../types/auth';
import { AuthContext } from './auth-context';

const areSessionsEqual = (left: AuthSession, right: AuthSession) =>
  left.accessToken === right.accessToken &&
  left.user.id === right.user.id &&
  left.user.username === right.user.username &&
  left.wallet.availableBtc === right.wallet.availableBtc &&
  left.wallet.reservedBtc === right.wallet.reservedBtc &&
  left.wallet.availableUsd === right.wallet.availableUsd &&
  left.wallet.reservedUsd === right.wallet.reservedUsd;

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(() =>
    getStoredAuthSession(),
  );

  const login = useCallback(
    (nextSession: AuthSession) => {
      queryClient.clear();
      storeAuthSession(nextSession);
      setSession(nextSession);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    queryClient.clear();
    clearAuthSession();
    setSession(null);
  }, [queryClient]);

  const updateSession = useCallback(
    (updater: (currentSession: AuthSession) => AuthSession) => {
      setSession((currentSession) => {
        if (!currentSession) {
          return currentSession;
        }

        const nextSession = updater(currentSession);

        if (areSessionsEqual(currentSession, nextSession)) {
          return currentSession;
        }

        storeAuthSession(nextSession);
        return nextSession;
      });
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session?.accessToken),
      login,
      logout,
      updateSession,
    }),
    [login, logout, session, updateSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
