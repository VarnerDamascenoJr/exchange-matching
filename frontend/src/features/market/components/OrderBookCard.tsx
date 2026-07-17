import {
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { OrderBookLevel } from '../../../types/market';
import { OrderSide } from '../../../types/orders';
import { formatBtc, formatUsd } from '../../../utils/format';
import { ListControls } from '../../../components/ListControls';

type OrderBookCardProps = {
  side: OrderSide;
  levels: OrderBookLevel[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  priceSearch: string;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  onPriceSearchChange: (nextPrice: string) => void;
  onLevelSelect: (level: OrderBookLevel) => void;
};

export function OrderBookCard({
  side,
  levels,
  page,
  pageSize,
  totalPages,
  totalItems,
  priceSearch,
  onPageChange,
  onPageSizeChange,
  onPriceSearchChange,
  onLevelSelect,
}: OrderBookCardProps) {
  const title = side === 'BUY' ? 'Bid book' : 'Ask book';

  return (
    <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
      <CardContent>
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
          >
            <Chip
              label={title}
              color={side === 'BUY' ? 'primary' : 'secondary'}
              size="small"
            />
            <Typography color="text.secondary" sx={{ minWidth: 0 }}>
              Click a row to prefill the opposite form.
            </Typography>
          </Stack>

          <ListControls
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            totalItems={totalItems}
            search={priceSearch}
            searchLabel="Price filter"
            searchPlaceholder="10000.00000000"
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            onSearchChange={onPriceSearchChange}
          />

          <TableContainer
            sx={{
              overflowX: 'auto',
              mx: { xs: -1, sm: 0 },
            }}
          >
            <Table
              size="small"
              aria-label={`${title} levels`}
              sx={{
                minWidth: { xs: 0, sm: 360 },
                '& .MuiTableCell-root': {
                  px: { xs: 1, sm: 2 },
                  py: 1,
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Price</TableCell>
                  <TableCell>Volume</TableCell>
                  <TableCell align="right" sx={{ width: { xs: 72, sm: 88 } }}>
                    Orders
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {levels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography color="text.secondary">
                        No levels available for this side.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  levels.map((level) => (
                    <TableRow
                      key={`${side}-${level.price}`}
                      hover
                      onClick={() => onLevelSelect(level)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>{formatUsd(level.price)}</TableCell>
                      <TableCell>{formatBtc(level.amount)}</TableCell>
                      <TableCell align="right">{level.orderCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </CardContent>
    </Card>
  );
}
