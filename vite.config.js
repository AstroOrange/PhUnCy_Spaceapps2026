import { VitePWA } from 'vite-plugin-pwa';

export default {
  base: './',
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Martian Map', short_name: 'Martian Map',
      theme_color: '#faf8f3', background_color: '#f3f0e8', display: 'standalone',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,json,bin,svg,woff2}'], // app + elevation data work offline
      maximumFileSizeToCacheInBytes: 5e6,
      runtimeCaching: [{ // map tiles you have viewed stay available offline
        urlPattern: /^https:\/\/(trek\.nasa\.gov|astro\.arcgis\.com)\//,
        handler: 'CacheFirst',
        options: { cacheName: 'mars-tiles', expiration: { maxEntries: 3000 } },
      }],
    },
  })],
};
