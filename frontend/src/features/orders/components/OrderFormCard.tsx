import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { isAxiosError } from 'axios';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { OrderSide } from '../../../types/orders';
import { multiplyDecimals, sanitizeDecimalInput } from '../../../utils/decimal';
import { formatUsd } from '../../../utils/format';
import { useCreateOrder } from '../hooks/useCreateOrder';
import { OrderFormValues, orderFormSchema } from '../schemas/orderFormSchema';

type PrefillValues = {
  amount: string;
  price: string;
};

type OrderFormCardProps = {
  side: OrderSide;
  title: string;
  subtitle: string;
  accent: 'primary' | 'secondary';
  prefill?: PrefillValues | null;
};

const resolveErrorMessage = (error: unknown) => {
  if (isAxiosError(error)) {
    return error.response?.data?.message ?? 'Unable to submit your order.';
  }

  return 'Unable to submit your order.';
};

export function OrderFormCard({
  side,
  title,
  subtitle,
  accent,
  prefill,
}: OrderFormCardProps) {
  const createOrderMutation = useCreateOrder();
  const {
    control,
    handleSubmit,
    register,
    reset,
    setValue,
    formState: { errors },
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      amount: '',
      price: '',
    },
  });

  const amount = useWatch({ control, name: 'amount' });
  const price = useWatch({ control, name: 'price' });
  const total = multiplyDecimals(amount, price);
  const amountField = register('amount', {
    onChange: (event) => {
      event.target.value = sanitizeDecimalInput(event.target.value);
    },
  });
  const priceField = register('price', {
    onChange: (event) => {
      event.target.value = sanitizeDecimalInput(event.target.value);
    },
  });

  useEffect(() => {
    if (!prefill) {
      return;
    }

    setValue('amount', prefill.amount, { shouldValidate: true });
    setValue('price', prefill.price, { shouldValidate: true });
  }, [prefill, setValue]);

  useEffect(() => {
    if (!createOrderMutation.isError && !createOrderMutation.isSuccess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      createOrderMutation.reset();
    }, 4_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    createOrderMutation,
    createOrderMutation.isError,
    createOrderMutation.isSuccess,
  ]);

  return (
    <Card elevation={0} sx={{ height: '100%', minWidth: 0 }}>
      <CardContent>
        <Stack spacing={3}>
          <Box>
            <Chip
              label={side === 'BUY' ? 'Buy BTC' : 'Sell BTC'}
              size="small"
              color={accent}
              sx={{ mb: 1.5 }}
            />
            <Typography variant="h5" sx={{ mb: 1 }}>
              {title}
            </Typography>
            <Typography color="text.secondary">{subtitle}</Typography>
          </Box>

          <Box
            component="form"
            onSubmit={handleSubmit((values) =>
              {
                createOrderMutation.reset();
                createOrderMutation.mutate(
                  {
                    side,
                    ...values,
                  },
                  {
                    onSuccess: () => {
                      reset({
                        amount: '',
                        price: '',
                      });
                    },
                  },
                );
              }
            )}
            noValidate
          >
            <Stack spacing={2}>
              <TextField
                label="Amount (BTC)"
                placeholder="0.50000000"
                error={Boolean(errors.amount)}
                helperText={errors.amount?.message}
                disabled={createOrderMutation.isPending}
                slotProps={{
                  htmlInput: {
                    inputMode: 'decimal',
                  },
                  inputLabel: {
                    shrink: Boolean(amount),
                  },
                }}
                {...amountField}
              />

              <TextField
                label="Price (USD)"
                placeholder="10000.00000000"
                error={Boolean(errors.price)}
                helperText={errors.price?.message}
                disabled={createOrderMutation.isPending}
                slotProps={{
                  htmlInput: {
                    inputMode: 'decimal',
                  },
                  inputLabel: {
                    shrink: Boolean(price),
                  },
                }}
                {...priceField}
              />

              <Box
                sx={{
                  borderRadius: 4,
                  px: 2,
                  py: 1.5,
                  bgcolor:
                    side === 'BUY'
                      ? 'rgba(0,95,115,0.08)'
                      : 'rgba(202,103,2,0.08)',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Total
                </Typography>
                <Typography variant="h6">{formatUsd(total)}</Typography>
              </Box>

              {createOrderMutation.isError ? (
                <Alert severity="error">
                  {resolveErrorMessage(createOrderMutation.error)}
                </Alert>
              ) : null}

              {createOrderMutation.isSuccess ? (
                <Alert severity="success">
                  Order accepted with status {createOrderMutation.data.status}.
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="contained"
                color={accent}
                size="large"
                disabled={createOrderMutation.isPending}
              >
                {createOrderMutation.isPending
                  ? 'Submitting...'
                  : side === 'BUY'
                    ? 'Submit buy order'
                    : 'Submit sell order'}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
