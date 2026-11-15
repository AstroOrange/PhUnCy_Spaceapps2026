import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { VitePWA } from 'vite-plugin-pwa';

// `npm run dev:phone` serves the app over https on the local network, so a phone can use its motion sensors in POV
// (phones hide them from http pages). It makes its own certificate with openssl the first time, kept in .cert/
// (not committed). The phone will warn that the certificate is not trusted: that is expected for a home-made one.
function phoneCert() {
  const dir = '.cert', key = `${dir}/key.pem`, cert = `${dir}/cert.pem`;
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    const ips = Object.values(networkInterfaces()).flat().filter(n => n.family === 'IPv4').map(n => `IP:${n.address}`);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-keyout', key, '-out', cert,
      '-subj', '/CN=Arcadia Pathfinder dev', '-addext', `subjectAltName=DNS:localhost,${ips.join(',')}`], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export default ({ mode }) => ({
  base: './',
  server: mode === 'phone' ? { host: true, https: phoneCert() } : {},
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Arcadia Pathfinder', short_name: 'Pathfinder',
      theme_color: '#ffffff', background_color: '#ffffff', display: 'standalone',
      icons: [{ src: 'logo-192.png', sizes: '192x192', type: 'image/png' }, { src: 'logo-512.png', sizes: '512x512', type: 'image/png' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,json,png,woff2}'], // the app works offline
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
});
