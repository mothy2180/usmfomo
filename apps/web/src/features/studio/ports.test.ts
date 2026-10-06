import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isRefusal } from './submitPost.ts'
import type { PostInsertRow } from './types.ts'

type Result = { data: unknown; error: unknown; status: number }

// A stand-in for the PostgREST query builder: records each call and resolves
// (when awaited) to the scripted result.
const mock = vi.hoisted(() => ({ calls: [] as string[], result: { data: null, error: null, status: 200 } as Result }))

vi.mock('../../lib/db.ts', () => {
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {}
    for (const name of ['insert', 'update', 'delete', 'select', 'eq', 'is', 'single', 'limit']) {
      b[name] = (...args: unknown[]) => {
        mock.calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`)
        return b
      }
    }
    b.then = (resolve: (r: Result) => void) => resolve(mock.result)
    return b
  }
  return {
    studioDb: {
      from: (table: string) => {
        mock.calls.push(`from(${table})`)
        return builder()
      },
    },
  }
})

const { studioPorts } = await import('./ports.ts')

const ORG = '11111111-1111-4111-8111-111111111111'
const row: PostInsertRow = {
  title: 'Hack Night',
  venue: 'DK A',
  campus: 'main',
  description: null,
  link_url: null,
  starts_at: '2026-10-11T12:00:00.000Z',
  ends_at: '2026-10-11T14:00:00.000Z',
  poster_path: null,
  thumb_path: null,
}
const reject = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)

describe('studioPorts', () => {
  beforeEach(() => {
    mock.calls = []
  })

  it('throws PostgREST errors with the HTTP status, so a refusal can be told from a lost answer', async () => {
    mock.result = { data: null, error: { code: '', message: 'Payload too large', details: null, hint: null }, status: 413 }
    const refused = await reject(studioPorts.insert(row))
    expect(refused).toEqual({ code: '', message: 'Payload too large', details: null, hint: null, status: 413 })
    expect(isRefusal(refused)).toBe(true)

    // postgrest-js when the response never came: code '' and status 0.
    mock.result = { data: null, error: { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' }, status: 0 }
    expect(isRefusal(await reject(studioPorts.insert(row)))).toBe(false)
    expect(isRefusal(await reject(studioPorts.update('p1', { title: 'New' })))).toBe(false)

    mock.result = { data: null, error: { code: 'P0001', message: 'quota_edits', details: null, hint: null }, status: 400 }
    expect(await reject(studioPorts.update('p1', { title: 'New' }))).toMatchObject({ code: 'P0001', message: 'quota_edits', status: 400 })
  })

  it('reports an update that matched no row as a refusal (NO_ROWS)', async () => {
    mock.result = { data: [], error: null, status: 200 }
    const err = await reject(studioPorts.update('p1', { title: 'New' }))
    expect(err).toEqual({ code: '42501', message: 'no rows matched' })
    expect(isRefusal(err)).toBe(true)
  })

  it('finds the own post a lost insert may have written by its poster file', async () => {
    mock.result = { data: [{ id: 'p1' }], error: null, status: 200 }
    const withPoster = { ...row, poster_path: `${ORG}/a.webp`, thumb_path: `${ORG}/a-thumb.webp` }
    await expect(studioPorts.findOwn(ORG, withPoster)).resolves.toEqual({ id: 'p1' })
    expect(mock.calls).toEqual(['from(posts)', 'select("id")', `eq("org_id","${ORG}")`, `eq("poster_path","${ORG}/a.webp")`, 'limit(1)'])
  })

  it('without a poster, by the same details (and no poster), or null', async () => {
    mock.result = { data: [], error: null, status: 200 }
    await expect(studioPorts.findOwn(ORG, row)).resolves.toBeNull()
    expect(mock.calls).toEqual([
      'from(posts)',
      'select("id")',
      `eq("org_id","${ORG}")`,
      'eq("title","Hack Night")',
      'eq("venue","DK A")',
      `eq("starts_at","${row.starts_at}")`,
      `eq("ends_at","${row.ends_at}")`,
      'is("poster_path",null)',
      'limit(1)',
    ])
  })

  it('throws when it cannot look', async () => {
    mock.result = { data: null, error: { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' }, status: 0 }
    expect(await reject(studioPorts.findOwn(ORG, row))).toMatchObject({ status: 0 })
  })
})
