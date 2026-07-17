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
import { UserTradeHistoryItem } from '../../../types/trades';
import { formatBtc, formatTimestamp, formatUsd } from '../../../utils/format';

type TradeHistoryCardProps = {
  items: UserTradeHistoryItem[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  search: string;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  onSearchChange: (nextSearch: string) => void;
};

export function TradeHistoryCard({
  items,
  page,
  pageSize,
  totalPages,
  totalItems,
  search,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
}: TradeHistoryCardProps) {
  return (
    <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label="My history" color="primary" size="small" />
            <Typography color="text.secondary">
              Recent personal matches with fee direction and role.
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
            <Table size="small" aria-label="Trade history" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Trade ID</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Price</TableCell>
                  <TableCell>Volume</TableCell>
                  <TableCell>Fee</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary">
                        No fills found for this filter.
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
                      <TableCell>{trade.side}</TableCell>
                      <TableCell>{trade.role}</TableCell>
                      <TableCell>{formatUsd(trade.price)}</TableCell>
                      <TableCell>{formatBtc(trade.amount)}</TableCell>
                      <TableCell>
                        {trade.feeAsset === 'USD'
                          ? formatUsd(trade.feeAmount)
                          : formatBtc(trade.feeAmount)}
                      </TableCell>
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
