import axios from 'axios';
import { getStoredAuthState } from './session-storage';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  const authState = getStoredAuthState();

  if (authState?.accessToken) {
    config.headers.Authorization = `Bearer ${authState.accessToken}`;
  }

  return config;
});
