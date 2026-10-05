import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Stricter CSP than the public site: no blob:/media, connect only to Supabase. */
export function adminCsp(supabaseUrl: string): string {
  const supa = new URL(supabaseUrl).origin
  const directives = [
    "default-src 'none'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self'",
    `img-src 'self' data: ${supa}`,
    `connect-src ${supa}`,
    "font-src 'self'",
    'frame-src https://challenges.cloudflare.com',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ]
  if (supa.startsWith('https://')) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

// usmfomo-admin Pages project: one HTML entry; Pages' SPA fallback serves it
// for every path (never ship a 404.html).
function pagesHeaders(supabaseUrl: string): Plugin {
  return {
    name: 'usmfomo-admin-headers',
    apply: 'build',
    generateBundle() {
      const lines = [
        '/*',
        `  Content-Security-Policy: ${adminCsp(supabaseUrl)}`,
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: no-referrer',
        '  Cross-Origin-Opener-Policy: same-origin',
        '  X-Frame-Options: DENY',
        '  X-Robots-Tag: noindex, nofollow',
        '  Cache-Control: no-store',
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
    plugins: [react(), tailwindcss(), pagesHeaders(supabaseUrl)],
    build: { assetsInlineLimit: 0, sourcemap: false },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  }
})
