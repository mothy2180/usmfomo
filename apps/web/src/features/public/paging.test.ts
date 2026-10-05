import { describe, expect, it } from 'vitest'
import { countOf, flattenPages, nextOffset, totalOf } from './paging.ts'
import type { PostCard, PostPage } from './types.ts'

const card = (id: string, total: number): PostCard => ({
  id,
  org_id: 'o',
  org_name: 'Org',
  org_slug: 'org',
  org_type: 'club',
  campus: 'main',
  title: `Event ${id}`,
  venue: 'Hall',
  starts_at: '2026-10-12T01:00:00Z',
  ends_at: '2026-10-12T02:00:00Z',
  thumb_path: null,
  cancelled_at: null,
  details_changed_at: null,
  total,
})
const page = (offset: number, ids: string[], total: number): PostPage => ({ rows: ids.map((id) => card(id, total)), total, offset })

describe('paging', () => {
  it('asks for the next offset until the total is loaded', () => {
    const ids20 = Array.from({ length: 20 }, (_, i) => `a${i}`)
    expect(nextOffset(page(0, ids20, 45))).toBe(20)
    expect(nextOffset(page(20, ids20, 45))).toBe(40)
    expect(nextOffset(page(40, ['x', 'y', 'z', 'w', 'v'], 45))).toBeUndefined()
  })

  it('stops on an empty page even if the count said more', () => {
    expect(nextOffset(page(20, [], 0))).toBeUndefined()
    expect(nextOffset(page(0, [], 0))).toBeUndefined()
  })

  it('drops a card that shifted onto the next page', () => {
    const pages = [page(0, ['a', 'b'], 4), page(2, ['b', 'c', 'd'], 4)]
    expect(flattenPages(pages).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('uses the newest count from a page with rows', () => {
    expect(totalOf([])).toBe(0)
    expect(totalOf([page(0, ['a'], 30), page(20, ['b'], 29)])).toBe(29)
    expect(totalOf([page(0, ['a'], 30), page(20, [], 0)])).toBe(30)
    expect(countOf(undefined)).toBeUndefined()
    expect(countOf({ pages: [page(0, [], 0)] })).toBe(0)
  })
})
