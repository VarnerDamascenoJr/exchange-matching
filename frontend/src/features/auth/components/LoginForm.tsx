import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { isAxiosError } from 'axios';
import { useForm } from 'react-hook-form';
import { useLogin } from '../hooks/useLogin';
import { LoginFormValues, loginSchema } from '../schemas/loginSchema';

const resolveErrorMessage = (error: unknown) => {
  if (isAxiosError(error)) {
    return error.response?.data?.message ?? 'Unable to authenticate right now.';
  }

  return 'Unable to authenticate right now.';
};

export function LoginForm() {
  const loginMutation = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
    },
  });

  return (
    <Box
      component="form"
      onSubmit={handleSubmit((values) => loginMutation.mutate(values))}
      noValidate
    >
      <Stack spacing={3}>
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Enter the BTC/USD desk
          </Typography>
          <Typography color="text.secondary">
            Sign in only with your username. New accounts start with 100 BTC and
            100000 USD.
          </Typography>
        </Box>

        <TextField
          label="Username"
          placeholder="trader-alice"
          autoComplete="username"
          autoFocus
          error={Boolean(errors.username)}
          helperText={errors.username?.message}
          disabled={loginMutation.isPending}
          {...register('username')}
        />

        {loginMutation.isError ? (
          <Alert severity="error">{resolveErrorMessage(loginMutation.error)}</Alert>
        ) : null}

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={loginMutation.isPending}
        >
          {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
        </Button>
      </Stack>
    </Box>
  );
}
