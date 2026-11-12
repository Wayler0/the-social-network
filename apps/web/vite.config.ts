/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // The API (Kim) will run on :3000; requests to /api are forwarded there.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { environment: 'node' },
});
