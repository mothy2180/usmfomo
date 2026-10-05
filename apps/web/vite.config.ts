import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'

// Production (Cloudflare Pages): public/_redirects rewrites "/" to landing.html
// ("/  /landing  200") and Pages' SPA fallback serves index.html (the app shell)
// for every other unknown path. Never ship a 404.html: it disables that fallback.
// Dev and preview mirror the "/" rewrite here.
function landingAtRoot(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url === '/' || req.url?.startsWith('/?')) req.url = '/landing.html' + req.url.slice(1)
    next()
  }
  return {
    name: 'usmfomo-landing-at-root',
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite)
    },
  }
}

/** Content-Security-Policy for the public site, built from the Supabase URL. */
export function publicCsp(supabaseUrl: string): string {
  const supa = new URL(supabaseUrl).origin
  const directives = [
    "default-src 'none'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self'",
    `img-src 'self' data: blob: ${supa}`,
    "media-src 'self' blob:",
    `connect-src 'self' ${supa}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    'frame-src https://challenges.cloudflare.com',
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ]
  // Only in production: locally Supabase is plain http on 127.0.0.1.
  if (supa.startsWith('https://')) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

// Cloudflare Pages reads dist/_headers. Generated here so the CSP always names
// the Supabase project this build talks to. Rules: max 100, 2,000 chars/line;
// never set Cache-Control under /* (values of matching rules are concatenated).
function pagesHeaders(supabaseUrl: string): Plugin {
  return {
    name: 'usmfomo-pages-headers',
    apply: 'build',
    generateBundle() {
      const csp = publicCsp(supabaseUrl)
      if (csp.length > 1900) throw new Error('CSP too long for a _headers line')
      const lines = [
        '/*',
        `  Content-Security-Policy: ${csp}`,
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Cross-Origin-Opener-Policy: same-origin',
        '  X-Frame-Options: DENY',
        '  Permissions-Policy: accelerometer=(), gyroscope=(), magnetometer=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
      ]
      this.emitFile({ type: 'asset', fileName: '_headers', source: lines.join('\n') })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  const supabaseUrl = env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
  return {
    plugins: [landingAtRoot(), react(), tailwindcss(), pagesHeaders(supabaseUrl)],
    build: {
      // Keep every asset as a hashed file under /assets (no data: URIs).
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 900,
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'index.html'),
          landing: resolve(import.meta.dirname, 'landing.html'),
        },
      },
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  }
})
