import { describe, expect, it } from 'vitest'
import { isEditable, isPubliclyVisible, postLabels, postTimeState } from './postLabels.ts'

const NOW = new Date('2026-10-05T02:00:00Z')
const post = (starts: string, ends: string, flags: { hidden_at?: string | null; cancelled_at?: string | null } = {}) => ({
  starts_at: starts,
  ends_at: ends,
  hidden_at: flags.hidden_at ?? null,
  cancelled_at: flags.cancelled_at ?? null,
})

const upcoming = post('2026-10-06T02:00:00Z', '2026-10-06T04:00:00Z')
const running = post('2026-10-05T01:00:00Z', '2026-10-05T03:00:00Z')
const ended = post('2026-10-04T01:00:00Z', '2026-10-05T02:00:00Z')

describe('postTimeState', () => {
  it('is upcoming, happening now or ended', () => {
    expect(postTimeState(upcoming, NOW)).toBe('upcoming')
    expect(postTimeState(running, NOW)).toBe('now')
    // Ends exactly now: over (the public read rule is ends_at > now()).
    expect(postTimeState(ended, NOW)).toBe('ended')
  })
})

describe('postLabels', () => {
  it('labels and tones the time state', () => {
    expect(postLabels(upcoming, NOW)).toEqual([{ label: 'upcoming', tone: 'sky' }])
    expect(postLabels(running, NOW)).toEqual([{ label: 'now', tone: 'ok' }])
    expect(postLabels(ended, NOW)).toEqual([{ label: 'ended', tone: 'neutral' }])
  })

  it('shows "Hidden by the usmfomo admin" first, then Cancelled', () => {
    const p = post(upcoming.starts_at, upcoming.ends_at, { hidden_at: '2026-10-04T00:00:00Z', cancelled_at: '2026-10-04T00:00:00Z' })
    expect(postLabels(p, NOW).map((l) => l.label)).toEqual(['hidden', 'cancelled', 'upcoming'])
  })
})

describe('visibility and editing', () => {
  it('has a public page only while not hidden and not over (cancelled posts stay up)', () => {
    expect(isPubliclyVisible(upcoming, NOW)).toBe(true)
    expect(isPubliclyVisible(post(upcoming.starts_at, upcoming.ends_at, { cancelled_at: '2026-10-04T00:00:00Z' }), NOW)).toBe(true)
    expect(isPubliclyVisible(post(upcoming.starts_at, upcoming.ends_at, { hidden_at: '2026-10-04T00:00:00Z' }), NOW)).toBe(false)
    expect(isPubliclyVisible(ended, NOW)).toBe(false)
  })

  it('cannot edit an ended post (it is purged within the hour)', () => {
    expect(isEditable(running, NOW)).toBe(true)
    expect(isEditable(ended, NOW)).toBe(false)
  })
})
