import axios from 'axios';
import { AuthSession, LoginPayload, UserProfile, WalletSummary } from '../types/auth';
import { getStoredAuthSession } from './session-storage';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  const session = getStoredAuthSession();

  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }

  return config;
});

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
