import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        '**/.devenv/**',
        '**/dist/**',
        '**/data/**',
        '**/coverage/**'
      ]
    }
  },
  test: {
    environment: 'node'
  }
});
