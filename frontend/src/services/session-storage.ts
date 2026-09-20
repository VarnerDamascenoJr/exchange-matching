import { StoredAuthState } from '../types/auth';

const AUTH_SESSION_STORAGE_KEY = 'exchange-matching.auth-session';

export const getStoredAuthState = (): StoredAuthState | null => {
  const rawSession = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);

  if (!rawSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(rawSession) as
      | StoredAuthState
      | { accessToken?: string };

    if (typeof parsedSession.accessToken !== 'string') {
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return null;
    }

    return { accessToken: parsedSession.accessToken };
  } catch {
    window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return null;
  }
};

export const storeAuthState = (authState: StoredAuthState) => {
  window.localStorage.setItem(
    AUTH_SESSION_STORAGE_KEY,
    JSON.stringify(authState),
  );
};

export const clearAuthSession = () => {
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
};
