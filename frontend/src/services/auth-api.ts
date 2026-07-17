import { AuthSession, LoginPayload, UserProfile, WalletSummary } from '../types/auth';
import { apiClient } from './http';

export const loginRequest = async (
  payload: LoginPayload,
): Promise<AuthSession> => {
  const { data } = await apiClient.post<AuthSession>('/auth/login', payload);
  return data;
};

export const getMeRequest = async (): Promise<UserProfile> => {
  const { data } = await apiClient.get<UserProfile>('/me');
  return data;
};

export const getWalletRequest = async (): Promise<WalletSummary> => {
  const { data } = await apiClient.get<WalletSummary>('/wallet');
  return data;
};
