import { Box, Container } from '@mui/material';
import { PropsWithChildren } from 'react';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        py: { xs: 4, md: 8 },
      }}
    >
      <Container maxWidth="lg">{children}</Container>
    </Box>
  );
}
