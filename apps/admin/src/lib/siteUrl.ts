// Links from the console to the public site (usmfomo.pages.dev).

export const DEFAULT_PUBLIC_SITE_URL = 'https://usmfomo.pages.dev'

/** Normalises VITE_PUBLIC_SITE_URL: an http(s) origin plus optional path, no
 * trailing slash. Anything else (empty, other schemes, user@host) falls back to
 * the production site. */
export function publicSiteUrl(value: string | undefined): string {
  const raw = value?.trim()
  if (!raw) return DEFAULT_PUBLIC_SITE_URL
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_PUBLIC_SITE_URL
    if (url.username || url.password) return DEFAULT_PUBLIC_SITE_URL
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return DEFAULT_PUBLIC_SITE_URL
  }
}

/** The public event page for a post. */
export function publicEventUrl(base: string, postId: string): string {
  return `${base}/e/${encodeURIComponent(postId)}`
}

/** The public organiser page. */
export function publicOrgUrl(base: string, slug: string): string {
  return `${base}/o/${encodeURIComponent(slug)}`
}

/** Where club and school accounts sign in. */
export function publicLoginUrl(base: string): string {
  return `${base}/login`
}
