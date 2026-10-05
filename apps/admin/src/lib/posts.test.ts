import { describe, expect, it } from 'vitest'
import { countByStatus, filterPosts, matchesText, postStatus } from './posts.ts'

const now = new Date('2026-10-05T06:00:00Z')

const post = (over: Partial<Parameters<typeof filterPosts>[0][number]> = {}) => ({
  title: 'Robot Wars',
  venue: 'Dewan Utama',
  ends_at: '2026-10-06T12:00:00Z',
  hidden_at: null as string | null,
  cancelled_at: null as string | null,
  org: { name: 'Robotics Club', slug: 'robotics-club' } as { name: string; slug: string } | null,
  ...over,
})

describe('postStatus', () => {
  it('gives each post exactly one actionable status', () => {
    expect(postStatus(post(), now)).toBe('live')
    expect(postStatus(post({ cancelled_at: '2026-10-05T01:00:00Z' }), now)).toBe('cancelled')
    expect(postStatus(post({ hidden_at: '2026-10-05T01:00:00Z', cancelled_at: '2026-10-05T01:00:00Z' }), now)).toBe('hidden')
    expect(postStatus(post({ ends_at: '2026-10-05T06:00:00Z', hidden_at: '2026-10-05T01:00:00Z' }), now)).toBe('expired')
  })
})

describe('filters', () => {
  const rows = [
    post(),
    post({ title: 'Malam Kebudayaan', venue: 'Panggung Seni', org: { name: 'Desasiswa Tekun', slug: 'desasiswa-tekun' } }),
    post({ title: 'Old talk', ends_at: '2026-10-01T00:00:00Z' }),
    post({ title: 'Hidden one', hidden_at: '2026-10-05T00:00:00Z' }),
  ]

  it('matches title, venue, organisation name or slug, ignoring case and accents', () => {
    expect(matchesText(rows[1]!, 'panggung')).toBe(true)
    expect(matchesText(rows[1]!, 'TEKUN')).toBe(true)
    expect(matchesText(rows[1]!, 'desasiswa-tek')).toBe(true)
    expect(matchesText(post({ title: 'Café Night' }), 'cafe')).toBe(true)
    expect(matchesText(rows[0]!, '   ')).toBe(true)
    expect(matchesText(rows[0]!, 'nothing')).toBe(false)
  })

  it('combines text and status', () => {
    expect(filterPosts(rows, { q: '', status: 'all' }, now)).toHaveLength(4)
    expect(filterPosts(rows, { q: '', status: 'expired' }, now).map((p) => p.title)).toEqual(['Old talk'])
    expect(filterPosts(rows, { q: 'robot', status: 'live' }, now).map((p) => p.title)).toEqual(['Robot Wars'])
    expect(filterPosts(rows, { q: 'robot', status: 'hidden' }, now).map((p) => p.title)).toEqual(['Hidden one'])
  })

  it('counts posts per status', () => {
    expect(countByStatus(rows, now)).toEqual({ all: 4, live: 2, cancelled: 0, hidden: 1, expired: 1 })
  })
})
