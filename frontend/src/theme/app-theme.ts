import { createTheme } from '@mui/material';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#005f73',
    },
    secondary: {
      main: '#ca6702',
    },
    background: {
      default: '#f7f4ea',
      paper: '#fffdf8',
    },
  },
  shape: {
    borderRadius: 20,
  },
  typography: {
    fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
    h3: {
      fontWeight: 700,
    },
    h4: {
      fontWeight: 700,
    },
  },
});
