export type UserProfile = {
  id: string;
  username: string;
};

export type WalletSummary = {
  availableBtc: string;
  reservedBtc: string;
  availableUsd: string;
  reservedUsd: string;
};

export type AuthSession = {
  accessToken: string;
  user: UserProfile;
  wallet: WalletSummary;
};

export type StoredAuthState = {
  accessToken: string;
};

export type LoginPayload = {
  username: string;
};

export type AuthContextValue = {
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (nextSession: AuthSession) => void;
  logout: () => void;
};
