import { eventGroup, type EventGroup } from '@usmfomo/shared/time'

/** Display order of the dashboard sections. */
export const SECTION_ORDER: readonly EventGroup[] = ['now', 'today', 'tomorrow', 'week', 'later']

export type Section<T> = { group: EventGroup; items: T[] }

type Timed = { starts_at: string; ends_at: string }

/**
 * Splits cards into Happening now / Today / Tomorrow / This week / Later (MYT
 * calendar days, see eventGroup). "Happening now" is ordered by soonest end,
 * every other section by start; ties keep the database order. Events that
 * ended after they were fetched are dropped, so a tab left open never shows
 * a finished event.
 */
export function groupIntoSections<T extends Timed>(items: readonly T[], now: Date = new Date()): Section<T>[] {
  const nowMs = now.getTime()
  const buckets = new Map<EventGroup, T[]>()
  for (const item of items) {
    if (Date.parse(item.ends_at) <= nowMs) continue
    const group = eventGroup(item.starts_at, item.ends_at, now)
    const list = buckets.get(group)
    if (list) list.push(item)
    else buckets.set(group, [item])
  }
  const sections: Section<T>[] = []
  for (const group of SECTION_ORDER) {
    const list = buckets.get(group)
    if (!list) continue
    const key = group === 'now' ? 'ends_at' : 'starts_at'
    // Array.prototype.sort is stable, so equal times keep the database order.
    list.sort((a, b) => Date.parse(a[key]) - Date.parse(b[key]))
    sections.push({ group, items: list })
  }
  return sections
}
