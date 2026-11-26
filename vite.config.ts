import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const googleMapsApiKey =
    env.VITE_GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  return {
    base: './',
    define: {
      __GOOGLE_MAPS_API_KEY__: JSON.stringify(googleMapsApiKey),
    },
    plugins: [
      react(),
      VitePWA({
      registerType: 'autoUpdate',
      useCredentials: true,
      includeAssets: ['apple-touch-icon.png', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        id: 'ca-roule-lestrevet',
        name: 'Ça roule ? – Horaires de roulage',
        short_name: 'Ça roule ?',
        description:
          'Calcul et prévision des créneaux de roulage pour le Char à Voile du Bout du Monde à la plage de Lestrevet.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#0284c7',
        background_color: '#ffffff',
        lang: 'fr',
        icons: [
          {
            src: './icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: './icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: './icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        globIgnores: ['assets/aistudio/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
    server: {
      host: '0.0.0.0',
      port: 3000,
      hmr: false,
      ws: false,
    },
  };
});
