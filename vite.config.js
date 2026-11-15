import { VitePWA } from 'vite-plugin-pwa';

export default {
  base: './',
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Arcadia Pathfinder', short_name: 'Pathfinder',
      theme_color: '#ffffff', background_color: '#ffffff', display: 'standalone',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,json,svg,woff2}'], // the app works offline
      maximumFileSizeToCacheInBytes: 5e6,
      runtimeCaching: [{ // terrain grids: cached by the app's own first download, not fetched a second time up front
        urlPattern: ({ url }) => url.pathname.endsWith('.i16'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'terrain-data', expiration: { maxEntries: 40 } },
      }, { // map tiles you have viewed stay available offline
        urlPattern: /^https:\/\/(trek\.nasa\.gov|astro\.arcgis\.com)\//,
        handler: 'CacheFirst',
        options: { cacheName: 'mars-tiles', expiration: { maxEntries: 3000 } },
      }],
    },
  })],
};
