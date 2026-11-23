import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Where the app is served from: '/' (Netlify, local) or '/my-finance-manager/' (GitHub Pages, set by the workflow)
const base = process.env.BASE_PATH ?? '/';
// The Android app (APK) carries every file inside it, so it needs no offline service worker
const androidApp = process.env.BUILD_TARGET === 'android';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      disable: androidApp,
      // updates wait for the user (src/lib/pwa.ts) so a running app never loses its own files
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'مدير أموالي — My Finance Manager',
        short_name: 'أموالي',
        description: 'مدير أموال شخصي يعمل دون إنترنت — Offline-first personal finance manager (Arabic & English)',
        lang: 'ar',
        dir: 'auto',
        categories: ['finance', 'productivity'],
        theme_color: '#1d4ed8',
        background_color: '#f2f5fa',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // every screen chunk (incl. the on-demand Excel library) is precached, so all features work offline
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // only the Latin and Arabic font subsets are needed offline
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
} as any);
