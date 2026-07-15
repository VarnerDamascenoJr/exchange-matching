import { GlobalStyles } from '@mui/material';

export function AppGlobalStyles() {
  return (
    <GlobalStyles
      styles={{
        ':root': {
          color: '#102a43',
          background:
            'radial-gradient(circle at top, #e9f5db 0%, #f7f4ea 45%, #f3efe2 100%)',
        },
        body: {
          margin: 0,
          minWidth: 320,
          minHeight: '100vh',
        },
        '#root': {
          minHeight: '100vh',
        },
      }}
    />
  );
}
