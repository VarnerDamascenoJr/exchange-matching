import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { PAGE_SIZE_OPTIONS } from '../types/pagination';

type ListControlsProps = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  search: string;
  searchLabel: string;
  searchPlaceholder: string;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  onSearchChange: (nextSearch: string) => void;
};

export function ListControls({
  page,
  pageSize,
  totalPages,
  totalItems,
  search,
  searchLabel,
  searchPlaceholder,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
}: ListControlsProps) {
  const safeTotalPages = Math.max(totalPages, 1);

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'minmax(0, 1fr) auto',
        },
        alignItems: 'start',
      }}
    >
      <TextField
        size="small"
        label={searchLabel}
        placeholder={searchPlaceholder}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        fullWidth
        sx={{
          gridColumn: { xs: '1 / -1', sm: '1 / 2' },
          minWidth: 0,
        }}
      />

      <FormControl
        size="small"
        sx={{
          minWidth: { xs: '100%', sm: 112 },
          width: { xs: '100%', sm: 'auto' },
        }}
      >
        <InputLabel id={`${searchLabel}-page-size`}>Rows</InputLabel>
        <Select
          labelId={`${searchLabel}-page-size`}
          label="Rows"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1.5,
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gridColumn: '1 / -1',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {totalItems} result{totalItems === 1 ? '' : 's'}
        </Typography>

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1.5,
            alignItems: { xs: 'flex-start', sm: 'center' },
            width: { xs: '100%', sm: 'auto' },
            justifyContent: { sm: 'flex-end' },
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Page {page} of {safeTotalPages}
          </Typography>

          <Pagination
            size="small"
            color="primary"
            page={Math.min(page, safeTotalPages)}
            count={safeTotalPages}
            onChange={(_event, nextPage) => onPageChange(nextPage)}
            disabled={totalPages <= 1}
            sx={{ alignSelf: { xs: 'stretch', sm: 'auto' } }}
          />
        </Box>
      </Box>
    </Box>
  );
}
