import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { Navigate } from 'react-router-dom';
import { AppShell } from '../app/AppShell';
import { LoginForm } from '../features/auth/components/LoginForm';
import { useAuth } from '../features/auth/hooks/useAuth';
import { formatBtc, formatUsd } from '../utils/format';

export function LoginPage() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/exchange" replace />;
  }

  return (
    <AppShell>
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 3, md: 4 },
          gridTemplateColumns: {
            xs: '1fr',
            md: 'minmax(0, 1fr) minmax(0, 1fr)',
          },
        }}
      >
        <Box>
          <Card
            elevation={0}
            sx={{
              height: '100%',
              background:
                'linear-gradient(155deg, rgba(0,95,115,0.98), rgba(10,147,150,0.9))',
              color: 'common.white',
              minWidth: 0,
            }}
          >
            <CardContent sx={{ p: { xs: 2.5, sm: 3, md: 5 }, height: '100%' }}>
              <Stack
                spacing={3}
                sx={{ height: '100%', justifyContent: 'space-between' }}
              >
                <Box>
                  <Chip
                    label="Exchange Matching"
                    sx={{
                      bgcolor: 'rgba(255,255,255,0.14)',
                      color: 'common.white',
                      mb: 3,
                    }}
                  />
                  <Typography
                    variant="h2"
                    sx={{ fontSize: { xs: 32, sm: 40, md: 52 }, mb: 2 }}
                  >
                    Built for matching speed, not ceremony.
                  </Typography>
                  <Typography
                    sx={{
                      maxWidth: 440,
                      color: 'rgba(255,255,255,0.8)',
                    }}
                  >
                    Authentication, balances, order flow and market activity are
                    all wired up from here into the exchange workspace.
                  </Typography>
                </Box>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <StatCard
                    label="Starter BTC"
                    value={formatBtc('100.00000000')}
                  />
                  <StatCard
                    label="Starter USD"
                    value={formatUsd('100000.00000000')}
                  />
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Box>

        <Box>
          <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
            <CardContent sx={{ p: { xs: 2.5, sm: 3, md: 5 } }}>
              <LoginForm />
            </CardContent>
          </Card>
        </Box>
      </Box>
    </AppShell>
  );
}

type StatCardProps = {
  label: string;
  value: string;
};

function StatCard({ label, value }: StatCardProps) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        borderRadius: 4,
        p: 2,
        bgcolor: 'rgba(255,255,255,0.12)',
      }}
    >
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.72)' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Box>
  );
}
