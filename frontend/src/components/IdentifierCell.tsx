import { Stack, Tooltip, Typography } from '@mui/material';
import { CopyValueButton } from './CopyValueButton';

type IdentifierCellProps = {
  value: string;
};

const formatIdentifier = (value: string) =>
  value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;

export function IdentifierCell({ value }: IdentifierCellProps) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Tooltip title={value} placement="top-start">
        <Typography
          component="span"
          sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
        >
          {formatIdentifier(value)}
        </Typography>
      </Tooltip>
      <CopyValueButton value={value} />
    </Stack>
  );
}
