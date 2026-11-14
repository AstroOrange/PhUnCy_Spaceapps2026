import { VitePWA } from 'vite-plugin-pwa';

export default {
  base: './',
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Martian Map', short_name: 'Martian Map',
      theme_color: '#ffffff', background_color: '#ffffff', display: 'standalone',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,json,svg,woff2}'], // the app works offline
      maximumFileSizeToCacheInBytes: 5e6,
      runtimeCaching: [{ // elevation data: each region is cached the first time you open it
        urlPattern: ({ url }) => url.pathname.endsWith('.bin'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'region-data', expiration: { maxEntries: 60 } },
      }, { // map tiles you have viewed stay available offline
        urlPattern: /^https:\/\/(trek\.nasa\.gov|astro\.arcgis\.com)\//,
        handler: 'CacheFirst',
        options: { cacheName: 'mars-tiles', expiration: { maxEntries: 3000 } },
      }],
    },
  })],
};
