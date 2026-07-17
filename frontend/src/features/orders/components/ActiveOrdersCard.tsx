import {
  Alert,
  Button,
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
import { isAxiosError } from 'axios';
import { ListControls } from '../../../components/ListControls';
import { OrderSummary } from '../../../types/orders';
import { formatBtc, formatTimestamp, formatUsd } from '../../../utils/format';
import { useCancelOrder } from '../hooks/useCancelOrder';

type ActiveOrdersCardProps = {
  items: OrderSummary[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  search: string;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  onSearchChange: (nextSearch: string) => void;
};

const resolveCancelError = (error: unknown) => {
  if (isAxiosError(error)) {
    return error.response?.data?.message ?? 'Unable to cancel this order.';
  }

  return 'Unable to cancel this order.';
};

export function ActiveOrdersCard({
  items,
  page,
  pageSize,
  totalPages,
  totalItems,
  search,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
}: ActiveOrdersCardProps) {
  const cancelOrderMutation = useCancelOrder();

  return (
    <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label="My active orders" color="secondary" size="small" />
            <Typography color="text.secondary">
              Cancel queued or open orders directly from the table.
            </Typography>
          </Stack>

          <ListControls
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            totalItems={totalItems}
            search={search}
            searchLabel="Order ID"
            searchPlaceholder="First 8 chars or full ID"
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            onSearchChange={onSearchChange}
          />

          {cancelOrderMutation.isError ? (
            <Alert severity="error">
              {resolveCancelError(cancelOrderMutation.error)}
            </Alert>
          ) : null}

          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Active orders" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Order ID</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Price</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary">
                        No active orders for this filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <IdentifierCell value={order.id} />
                      </TableCell>
                      <TableCell>{formatTimestamp(order.createdAt)}</TableCell>
                      <TableCell>{order.side}</TableCell>
                      <TableCell>{formatUsd(order.price)}</TableCell>
                      <TableCell>{formatBtc(order.remainingAmount)}</TableCell>
                      <TableCell>{order.status}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          disabled={cancelOrderMutation.isPending}
                          onClick={() => cancelOrderMutation.mutate(order.id)}
                        >
                          Cancel
                        </Button>
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
