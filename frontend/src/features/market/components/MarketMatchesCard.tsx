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
import { IdentifierCell } from '../../../components/IdentifierCell';
import { ListControls } from '../../../components/ListControls';
import { MarketMatchSummary } from '../../../types/market';
import { formatBtc, formatTimestamp, formatUsd } from '../../../utils/format';

type MarketMatchesCardProps = {
  items: MarketMatchSummary[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  search: string;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  onSearchChange: (nextSearch: string) => void;
};

export function MarketMatchesCard({
  items,
  page,
  pageSize,
  totalPages,
  totalItems,
  search,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
}: MarketMatchesCardProps) {
  return (
    <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
      <CardContent>
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
          >
            <Chip label="Global matches" color="primary" size="small" />
            <Typography color="text.secondary">
              Latest market executions, newest first.
            </Typography>
          </Stack>

          <ListControls
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            totalItems={totalItems}
            search={search}
            searchLabel="Trade ID"
            searchPlaceholder="First 8 chars or full ID"
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            onSearchChange={onSearchChange}
          />

          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table
              size="small"
              aria-label="Market matches"
              sx={{
                minWidth: 580,
                '& .MuiTableCell-root': {
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Trade ID</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Price</TableCell>
                  <TableCell>Volume</TableCell>
                  <TableCell>Side</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary">
                        No trades found.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell>
                        <IdentifierCell value={trade.id} />
                      </TableCell>
                      <TableCell>{formatTimestamp(trade.createdAt)}</TableCell>
                      <TableCell>{formatUsd(trade.price)}</TableCell>
                      <TableCell>{formatBtc(trade.amount)}</TableCell>
                      <TableCell>{trade.takerSide}</TableCell>
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
