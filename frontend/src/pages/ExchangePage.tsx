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
import { AppShell } from '../app/AppShell';
import { useAuth } from '../features/auth/hooks/useAuth';
import { StatsGrid } from '../features/market/components/StatsGrid';
import { MarketMatchesCard } from '../features/market/components/MarketMatchesCard';
import { OrderBookCard } from '../features/market/components/OrderBookCard';
import { useExchangePageData } from '../features/exchange/hooks/useExchangePageData';
import { ActiveOrdersCard } from '../features/orders/components/ActiveOrdersCard';
import { OrderFormCard } from '../features/orders/components/OrderFormCard';
import { TradeHistoryCard } from '../features/trades/components/TradeHistoryCard';

export function ExchangePage() {
  const { accessToken, logout } = useAuth();
  const {
    buyPrefill,
    sellPrefill,
    meQuery,
    walletQuery,
    marketStatsQuery,
    bidBookState,
    askBookState,
    matchesState,
    activeOrdersState,
    historyState,
    bidBookQuery,
    askBookQuery,
    marketMatchesQuery,
    activeOrdersQuery,
    historyQuery,
    isLoading,
    hasPageError,
    handleBidSelect,
    handleAskSelect,
  } = useExchangePageData({
    accessToken,
    onUnauthorized: logout,
  });

  return (
    <AppShell>
      <Stack spacing={4}>
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
              BTC/USD exchange
            </Typography>
            <Typography variant="h4" sx={{ mb: 1 }}>
              Matching desk
            </Typography>
            <Typography color="text.secondary">
              Submit limit orders, follow the book and watch market activity refresh
              in real time.
            </Typography>
          </Box>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ width: { xs: '100%', md: 'auto' } }}
          >
            <Card elevation={0} sx={{ minWidth: 0 }}>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Logged in as
                </Typography>
                <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                  {meQuery.data?.username ?? 'Authenticated user'}
                </Typography>
              </CardContent>
            </Card>

            <Button
              variant="outlined"
              onClick={logout}
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Sign out
            </Button>
          </Stack>
        </Stack>

        {isLoading ? (
          <Card elevation={0}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress size={20} />
                <Typography>Loading your exchange workspace...</Typography>
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        {hasPageError ? (
          <Alert severity="error">
            One or more exchange panels could not be loaded right now.
          </Alert>
        ) : null}

        {marketStatsQuery.data ? (
          <StatsGrid
            stats={marketStatsQuery.data}
            user={meQuery.data}
            wallet={walletQuery.data}
          />
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: {
              xs: '1fr',
              xl: 'repeat(12, minmax(0, 1fr))',
            },
          }}
        >
          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 6' } }}>
            <OrderFormCard
              side="BUY"
              accent="primary"
              title="Buy BTC"
              subtitle="Your order executes at your limit price or better."
              prefill={buyPrefill}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 6' } }}>
            <OrderFormCard
              side="SELL"
              accent="secondary"
              title="Sell BTC"
              subtitle="Click a bid on the book to auto-fill this ticket."
              prefill={sellPrefill}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 4' } }}>
            <OrderBookCard
              side="BUY"
              levels={bidBookQuery.data?.items ?? []}
              page={bidBookState.page}
              pageSize={bidBookState.pageSize}
              totalPages={bidBookQuery.data?.pagination.totalPages ?? 0}
              totalItems={bidBookQuery.data?.pagination.totalItems ?? 0}
              priceSearch={bidBookState.search}
              onPageChange={bidBookState.setPage}
              onPageSizeChange={bidBookState.setPageSize}
              onPriceSearchChange={bidBookState.setSearch}
              onLevelSelect={handleBidSelect}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 4' } }}>
            <OrderBookCard
              side="SELL"
              levels={askBookQuery.data?.items ?? []}
              page={askBookState.page}
              pageSize={askBookState.pageSize}
              totalPages={askBookQuery.data?.pagination.totalPages ?? 0}
              totalItems={askBookQuery.data?.pagination.totalItems ?? 0}
              priceSearch={askBookState.search}
              onPageChange={askBookState.setPage}
              onPageSizeChange={askBookState.setPageSize}
              onPriceSearchChange={askBookState.setSearch}
              onLevelSelect={handleAskSelect}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 4' } }}>
            <MarketMatchesCard
              items={marketMatchesQuery.data?.items ?? []}
              page={matchesState.page}
              pageSize={matchesState.pageSize}
              totalPages={marketMatchesQuery.data?.pagination.totalPages ?? 0}
              totalItems={marketMatchesQuery.data?.pagination.totalItems ?? 0}
              search={matchesState.search}
              onPageChange={matchesState.setPage}
              onPageSizeChange={matchesState.setPageSize}
              onSearchChange={matchesState.setSearch}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 6' } }}>
            <ActiveOrdersCard
              items={activeOrdersQuery.data?.items ?? []}
              page={activeOrdersState.page}
              pageSize={activeOrdersState.pageSize}
              totalPages={activeOrdersQuery.data?.pagination.totalPages ?? 0}
              totalItems={activeOrdersQuery.data?.pagination.totalItems ?? 0}
              search={activeOrdersState.search}
              onPageChange={activeOrdersState.setPage}
              onPageSizeChange={activeOrdersState.setPageSize}
              onSearchChange={activeOrdersState.setSearch}
            />
          </Box>

          <Box sx={{ gridColumn: { xs: 'span 1', xl: 'span 6' } }}>
            <TradeHistoryCard
              items={historyQuery.data?.items ?? []}
              page={historyState.page}
              pageSize={historyState.pageSize}
              totalPages={historyQuery.data?.pagination.totalPages ?? 0}
              totalItems={historyQuery.data?.pagination.totalItems ?? 0}
              search={historyState.search}
              onPageChange={historyState.setPage}
              onPageSizeChange={historyState.setPageSize}
              onSearchChange={historyState.setSearch}
            />
          </Box>
        </Box>
      </Stack>
    </AppShell>
  );
}
