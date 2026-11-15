/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // The API runs on :3000; requests to /api and /media (uploaded images) are forwarded there.
    proxy: { '/api': 'http://localhost:3000', '/media': 'http://localhost:3000' },
  },
  test: { environment: 'node' },
});
