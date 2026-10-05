// 2FA devices (TOTP factors). One factor per committee member, named after
// the person, so a lost phone can be removed without locking everyone out.
import { MYT_TZ, type Locale } from '@usmfomo/shared/time'

export type TotpFactor = { id: string; friendly_name?: string; factor_type: string; status: string; created_at: string }

/** Flag devices added in the last 7 days: an unexpected one may mean the
 * password leaked. */
export const RECENT_FACTOR_DAYS = 7

export function isRecentFactor(createdAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(createdAt)
  return Number.isFinite(t) && now.getTime() - t < RECENT_FACTOR_DAYS * 864e5
}

/** Verified TOTP factors, oldest first (enrolment order). */
export function verifiedTotp<F extends TotpFactor>(all: readonly F[]): F[] {
  return all
    .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}

export const DEVICE_NAME_MAX = 40

/** Person's name for a new device: trimmed, single spaces, no control characters. */
export function cleanDeviceName(raw: string): { ok: true; name: string } | { ok: false; key: string } {
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0) return { ok: false, key: 'studio:form.required' }
  if (name.length > DEVICE_NAME_MAX) return { ok: false, key: 'errors:too_long_text' }
  if (/\p{Cc}/u.test(name)) return { ok: false, key: 'errors:bad_chars' }
  return { ok: true, name }
}

/** "123 456" / "123-456" -> "123456" (at most 6 digits). */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

export const isCompleteCode = (code: string): boolean => /^\d{6}$/.test(code)

/** Setup key in groups of four for reading aloud / typing. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ')
}

/** Unverified TOTP factors: setups that were started but never confirmed. */
export function pendingTotp<F extends TotpFactor>(all: readonly F[]): F[] {
  return all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified')
}

const SVG_UTF8_PREFIX = 'data:image/svg+xml;utf-8,'

/** Auth's QR SVG has width/height but no viewBox, so it would not scale when
 * the <img> is sized by CSS; derive the viewBox from width/height. */
export function withViewBox(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/, (tag, attrs: string) => {
    if (/\bviewBox\s*=/.test(attrs)) return tag
    const w = /\bwidth\s*=\s*"(\d+(?:\.\d+)?)"/.exec(attrs)?.[1]
    const h = /\bheight\s*=\s*"(\d+(?:\.\d+)?)"/.exec(attrs)?.[1]
    return w && h ? `<svg viewBox="0 0 ${w} ${h}"${attrs}>` : tag
  })
}

/**
 * <img src> for enroll()'s totp.qr_code. supabase-js prefixes the raw SVG
 * with "data:image/svg+xml;utf-8," without escaping it, and a "#" in the SVG
 * would end the URL early, so the SVG is percent-encoded here. An SVG shown
 * through <img> cannot run scripts. Anything unexpected shows no QR code (the
 * setup key and the otpauth link still work).
 */
export function qrImageSrc(qr: string): string | null {
  const raw = qr.startsWith(SVG_UTF8_PREFIX) ? qr.slice(SVG_UTF8_PREFIX.length) : qr
  if (/^\s*<(\?xml|svg)[\s>]/.test(raw)) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withViewBox(raw))}`
  if (/^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/=]+$/.test(qr)) return qr
  return null
}

/** The "Open in authenticator app" link: only a real otpauth://totp/ URI. */
export function otpauthHref(uri: string): string | null {
  return /^otpauth:\/\/totp\/[^\s]+$/.test(uri) ? uri : null
}

/** "5 Oct 2026" (MYT) for "Added …". */
export function formatAddedDate(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : 'en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: MYT_TZ,
  }).format(d)
}

/** Which device the sign-in code form starts with: the only one, else the
 * one last used in this browser (if it still exists), else none (choose). */
export function initialFactorId(factors: readonly { id: string }[], remembered: string | null): string | null {
  if (factors.length === 1) return factors[0]!.id
  return remembered && factors.some((f) => f.id === remembered) ? remembered : null
}

/** Same name as an existing device (names are per person; case-insensitive). */
export function isNameTaken(name: string, factors: readonly TotpFactor[]): boolean {
  const n = name.toLowerCase()
  return factors.some((f) => (f.friendly_name ?? '').toLowerCase() === n)
}
