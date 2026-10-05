// Display helpers. Every date is shown in Malaysia time (MYT), whatever the
// device's time zone, like the rest of usmfomo.
import { MYT_TZ } from '@usmfomo/shared/time'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The maintenance heartbeat is overdue after 3 hours (cron runs hourly). */
export const MAINTENANCE_STALE_MS = 3 * HOUR

/** Supabase Free storage allowance (1 GB) and the bucket cap enforced by
 * private.can_upload_poster() (800 MiB). */
export const STORAGE_QUOTA_BYTES = 1024 ** 3
export const STORAGE_UPLOAD_CAP_BYTES = 800 * 1024 ** 2

/** "just now", "5 min ago", "3 h 5 min ago", "2 days ago"; null -> "never". */
export function formatAge(fromIso: string | null, now: Date): string {
  if (!fromIso) return 'never'
  const at = Date.parse(fromIso)
  if (Number.isNaN(at)) return 'unknown'
  const diff = now.getTime() - at
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    const m = Math.floor((diff % HOUR) / MINUTE)
    return m ? `${h} h ${m} min ago` : `${h} h ago`
  }
  const d = Math.floor(diff / DAY)
  return d === 1 ? '1 day ago' : `${d} days ago`
}

/** Red when the last run is more than 3 hours old, or there never was one. */
export function isMaintenanceStale(lastRunIso: string | null, now: Date): boolean {
  if (!lastRunIso) return true
  const at = Date.parse(lastRunIso)
  if (Number.isNaN(at)) return true
  return now.getTime() - at > MAINTENANCE_STALE_MS
}

/** Binary units, as storage quotas are counted: 1 KB = 1024 B. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Whole percent, clamped to 0–100. */
export function percentOf(part: number, whole: number): number {
  if (!(whole > 0) || !Number.isFinite(part)) return 0
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)))
}

const dateTimeParts = new Intl.DateTimeFormat('en-MY', {
  timeZone: MYT_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** "Mon 5 Oct 2026, 2:20 PM" in MYT; "—" for null. */
export function formatMytDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p: Record<string, string> = {}
  for (const part of dateTimeParts.formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = part.value
  }
  const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : ''
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}${period}`
}

/** True when `iso` lies within the last `days` days (future dates count too). */
export function isWithinDays(iso: string | null | undefined, days: number, now: Date): boolean {
  if (!iso) return false
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return false
  return now.getTime() - at <= days * DAY
}

/** "1 post" / "3 posts". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
