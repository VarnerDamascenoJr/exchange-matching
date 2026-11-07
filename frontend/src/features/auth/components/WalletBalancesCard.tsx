import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { UserProfile, WalletSummary } from '../../../types/auth';
import { parseDecimal } from '../../../utils/decimal';
import { formatBtc, formatUsd } from '../../../utils/format';

type WalletBalancesCardProps = {
  user?: UserProfile;
  wallet?: WalletSummary;
};

export function WalletBalancesCard({ user, wallet }: WalletBalancesCardProps) {
  const assets = [
    {
      name: 'BTC',
      available: wallet?.availableBtc,
      reserved: wallet?.reservedBtc,
      format: formatBtc,
    },
    {
      name: 'USD',
      available: wallet?.availableUsd,
      reserved: wallet?.reservedUsd,
      format: formatUsd,
    },
  ];

  return (
    <Card
      component="section"
      aria-label="Wallet balances"
      elevation={0}
      sx={{ minWidth: 0, gridColumn: '1 / -1' }}
    >
      <CardContent>
        <Stack spacing={2}>
          <Typography
            variant="h6"
            component="h2"
            sx={{ overflowWrap: 'anywhere' }}
          >
            {user ? `${user.username} balances` : 'Your balances'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Available can be used for new orders. Reserved is committed to
            active orders. Total is available plus reserved.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: 'repeat(2, minmax(0, 1fr))',
              },
            }}
          >
            {assets.map(({ name, available, reserved, format }) => {
              const total = wallet
                ? parseDecimal(available)
                    .plus(parseDecimal(reserved))
                    .toFixed(8)
                : null;
              return (
                <Box
                  component="section"
                  aria-label={`${name} balances`}
                  key={name}
                  sx={{ minWidth: 0 }}
                >
                  <Typography
                    variant="subtitle1"
                    component="h3"
                    color="primary.main"
                    sx={{ mb: 1 }}
                  >
                    {name}
                  </Typography>
                  <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1 }}>
                    {[
                      { label: 'Available', value: available },
                      { label: 'Reserved', value: reserved },
                      { label: 'Total', value: total },
                    ].map(({ label, value }) => (
                      <Box
                        key={label}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: 'max-content minmax(0, 1fr)',
                          gap: 2,
                          ...(label === 'Total'
                            ? { borderTop: 1, borderColor: 'divider', pt: 1 }
                            : {}),
                        }}
                      >
                        <Typography
                          component="dt"
                          variant="body2"
                          color="text.secondary"
                        >
                          {label}
                        </Typography>
                        <Typography
                          component="dd"
                          variant="body2"
                          aria-label={`${name} ${label.toLowerCase()} balance`}
                          sx={{
                            m: 0,
                            textAlign: 'right',
                            overflowWrap: 'anywhere',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: label === 'Total' ? 700 : 400,
                          }}
                        >
                          {format(value)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
