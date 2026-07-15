import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect } from 'react';
import { AppShell } from '../app/AppShell';
import { useAuth } from '../features/auth/hooks/useAuth';
import { getMeRequest, getWalletRequest } from '../services/api';

export function ExchangePage() {
  const { logout, session, updateSession } = useAuth();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: getMeRequest,
    initialData: session?.user,
    staleTime: 60_000,
  });

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: getWalletRequest,
    initialData: session?.wallet,
    staleTime: 60_000,
  });

  const hasAuthFailure = [meQuery.error, walletQuery.error].some(
    (error) => isAxiosError(error) && error.response?.status === 401,
  );

  useEffect(() => {
    if (hasAuthFailure) {
      logout();
    }
  }, [hasAuthFailure, logout]);

  useEffect(() => {
    if (meQuery.data && walletQuery.data) {
      updateSession((currentSession) => ({
        ...currentSession,
        user: meQuery.data,
        wallet: walletQuery.data,
      }));
    }
  }, [meQuery.data, updateSession, walletQuery.data]);

  const isLoading = meQuery.isLoading || walletQuery.isLoading;
  const hasError = meQuery.isError || walletQuery.isError;

  return (
    <AppShell>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{
            justifyContent: 'space-between',
            alignItems: { xs: 'flex-start', md: 'center' },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="primary.main">
              Exchange
            </Typography>
            <Typography variant="h4">BTC/USD workspace</Typography>
            <Typography color="text.secondary">
              Authentication is live. Market modules come in the next steps.
            </Typography>
          </Box>

          <Button
            variant="outlined"
            onClick={logout}
            sx={{ width: { xs: '100%', md: 'auto' } }}
          >
            Sign out
          </Button>
        </Stack>

        {isLoading ? (
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress size={20} />
                <Typography>Loading your session...</Typography>
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        {hasError ? (
          <Alert severity="error">
            Unable to load your profile from the API right now.
          </Alert>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(12, minmax(0, 1fr))',
            },
          }}
        >
          <Box sx={{ gridColumn: { xs: 'span 1', md: 'span 4' } }}>
            <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Username
                </Typography>
                <Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>
                  {meQuery.data?.username ?? session?.user.username}
                </Typography>
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', md: 'span 4' } }}>
            <BalanceCard
              label="Available BTC"
              value={walletQuery.data?.availableBtc ?? session?.wallet.availableBtc}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', md: 'span 4' } }}>
            <BalanceCard
              label="Available USD"
              value={walletQuery.data?.availableUsd ?? session?.wallet.availableUsd}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', md: 'span 6' } }}>
            <BalanceCard
              label="Reserved BTC"
              value={walletQuery.data?.reservedBtc ?? session?.wallet.reservedBtc}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', md: 'span 6' } }}>
            <BalanceCard
              label="Reserved USD"
              value={walletQuery.data?.reservedUsd ?? session?.wallet.reservedUsd}
            />
          </Box>
        </Box>
      </Stack>
    </AppShell>
  );
}

type BalanceCardProps = {
  label: string;
  value?: string;
};

function BalanceCard({ label, value }: BalanceCardProps) {
  return (
    <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
      <CardContent>
        <Typography color="text.secondary" gutterBottom>
          {label}
        </Typography>
        <Typography
          variant="h5"
          sx={{ fontSize: { xs: '1.25rem', md: '1.5rem' }, overflowWrap: 'anywhere' }}
        >
          {value ?? '-'}
        </Typography>
      </CardContent>
    </Card>
  );
}
