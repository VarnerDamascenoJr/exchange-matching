import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { loginRequest } from '../../../services/auth-api';
import { useAuth } from './useAuth';

export function useLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();

  return useMutation({
    mutationFn: loginRequest,
    onSuccess: (session) => {
      login(session);
      navigate('/exchange', { replace: true });
    },
  });
}
