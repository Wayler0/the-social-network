/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME, APP_TAGLINE, THEME_COLOR } from './src/config';

/** Fills %APP_NAME% and friends in index.html from src/config.ts, so the name lives in one place. */
function appConfigInHtml(): Plugin {
  const values: Record<string, string> = { APP_NAME, APP_TAGLINE, THEME_COLOR };
  return {
    name: 'app-config-in-html',
    transformIndexHtml: (html) => html.replace(/%(APP_NAME|APP_TAGLINE|THEME_COLOR)%/g, (_, key: string) => values[key]),
  };
}

export default defineConfig({
  plugins: [
    react(),
    appConfigInHtml(),
    VitePWA({
      // A new version waits until the member taps "Reload" (UpdateBanner), so nothing they are typing is lost.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_TAGLINE,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFFFFF',
        theme_color: THEME_COLOR,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Only the app itself (HTML, JS, CSS, fonts, icons) is cached, so it opens on a bad connection.
        // API answers and uploaded photos are never cached: they are members-only and a phone may be shared.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//],
        cleanupOutdatedCaches: true,
        // Web Push (v0.2): the push and notification-click handlers live in public/push-sw.js.
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
  server: {
    port: 5180,
    // The API runs on :3000; requests to /api and /media (uploaded images) are forwarded there.
    proxy: { '/api': 'http://localhost:3000', '/media': 'http://localhost:3000' },
  },
  test: { environment: 'node' },
});
