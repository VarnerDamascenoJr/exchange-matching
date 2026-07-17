import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const hasSegment = (value: string, segment: string) => value.indexOf(segment) >= 0;

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!hasSegment(id, 'node_modules')) {
            return undefined;
          }

          if (hasSegment(id, '@mui') || hasSegment(id, '@emotion')) {
            return 'ui-vendor';
          }

          if (hasSegment(id, '@tanstack/react-query')) {
            return 'query-vendor';
          }

          if (hasSegment(id, 'socket.io-client')) {
            return 'realtime-vendor';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
