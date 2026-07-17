import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { MarketStatsSummary } from '../../../types/market';
import { UserProfile, WalletSummary } from '../../../types/auth';
import { formatBtc, formatUsd } from '../../../utils/format';

type StatsGridProps = {
  stats: MarketStatsSummary;
  user?: UserProfile;
  wallet?: WalletSummary;
};

export function StatsGrid({ stats, user, wallet }: StatsGridProps) {
  const cards = [
    {
      label: 'Last price',
      value: formatUsd(stats.lastPrice),
      tone: 'primary.main',
    },
    {
      label: 'BTC volume 24h',
      value: formatBtc(stats.btcVolume24h),
      tone: 'secondary.main',
    },
    {
      label: 'USD volume 24h',
      value: formatUsd(stats.usdVolume24h),
      tone: 'secondary.main',
    },
    {
      label: 'High 24h',
      value: formatUsd(stats.high24h),
      tone: 'success.main',
    },
    {
      label: 'Low 24h',
      value: formatUsd(stats.low24h),
      tone: 'error.main',
    },
    {
      label: 'Best bid',
      value: formatUsd(stats.bestBid),
      tone: 'primary.main',
    },
    {
      label: 'Best ask',
      value: formatUsd(stats.bestAsk),
      tone: 'secondary.main',
    },
    {
      label: user ? `${user.username} balances` : 'Your balances',
      value: `${formatBtc(wallet?.availableBtc ?? null)} / ${formatUsd(
        wallet?.availableUsd ?? null,
      )}`,
      tone: 'text.primary',
    },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          xl: 'repeat(4, minmax(0, 1fr))',
        },
      }}
    >
      {cards.map((card) => (
        <Card key={card.label} elevation={0} sx={{ minWidth: 0 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Chip
                label={card.label}
                size="small"
                sx={{
                  alignSelf: 'flex-start',
                  bgcolor: 'rgba(0,95,115,0.08)',
                  color: 'primary.main',
                }}
              />
              <Typography
                variant="h5"
                sx={{ color: card.tone, overflowWrap: 'anywhere' }}
              >
                {card.value}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
