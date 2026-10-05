// Status bar text: "Live 12/15 · New in last 24 h 3/5 · next slot 14:20" (MYT).
import { formatDay, isoToMytInput, mytDayKey, type Locale } from '@usmfomo/shared/time'
import type { OkStatus } from '../../lib/session.ts'

export type Usage = { used: number; limit: number; full: boolean }

export type StatusBarParts = {
  live: Usage
  daily: Usage
  edits: Usage
  /** When the next new-post slot opens (only while the daily limit is full). */
  nextSlot: string | null
}

const usage = (used: number, limit: number): Usage => ({ used, limit, full: used >= limit })

/** "14:20" today, "Tue 6 Oct 09:10" on another day — always MYT, 24-hour. */
export function formatSlotTime(iso: string, now: Date, locale: Locale): string {
  const { time } = isoToMytInput(iso)
  return mytDayKey(iso) === mytDayKey(now) ? time : `${formatDay(iso, locale)} ${time}`
}

export function statusBarParts(status: OkStatus, now: Date = new Date(), locale: Locale = 'en'): StatusBarParts {
  const daily = usage(status.new_24h, status.new_limit)
  return {
    live: usage(status.live, status.live_limit),
    daily,
    edits: usage(status.edits_24h, status.edits_limit),
    nextSlot: daily.full && status.next_slot_at ? formatSlotTime(status.next_slot_at, now, locale) : null,
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/** The status bar items as text, in order (the UI joins them with " · "). */
export function statusBarItems(t: Translate, parts: StatusBarParts): string[] {
  const items = [
    t('status.live', { used: parts.live.used, limit: parts.live.limit }),
    t('status.daily', { used: parts.daily.used, limit: parts.daily.limit }),
  ]
  if (parts.nextSlot) items.push(t('status.nextSlot', { time: parts.nextSlot }))
  return items
}

export type NewPostBlock = 'paused' | 'live' | 'daily' | null
export type EditBlock = 'paused' | 'edits' | null

/** Why "New post" is unavailable right now (mirrors posts_guard). */
export function newPostBlock(status: OkStatus): NewPostBlock {
  if (!status.posting_enabled) return 'paused'
  if (status.live >= status.live_limit) return 'live'
  if (status.new_24h >= status.new_limit) return 'daily'
  return null
}

/** Why "Edit" is unavailable right now (mirrors posts_guard). */
export function editBlock(status: OkStatus): EditBlock {
  if (!status.posting_enabled) return 'paused'
  if (status.edits_24h >= status.edits_limit) return 'edits'
  return null
}

/** The reason "New post" is unavailable, as text; null while it is available. */
export function newPostBlockText(t: Translate, status: OkStatus, now: Date, locale: Locale): string | null {
  switch (newPostBlock(status)) {
    case 'paused':
      return t('errors:posting_paused')
    case 'live':
      return t('home.blockedLive', { limit: status.live_limit })
    case 'daily':
      return status.next_slot_at
        ? t('home.blockedDailyAt', { limit: status.new_limit, time: formatSlotTime(status.next_slot_at, now, locale) })
        : t('home.blockedDaily', { limit: status.new_limit })
    default:
      return null
  }
}
