import { describe, expect, it } from 'vitest'
import tilemapJson from './media/tilemap.json'
import { mediaUrl, TILEMAP } from './media.ts'
import { coverUv, makeShards } from './shards.ts'
import { checkTilemap, tileCount, tileRect, type Tilemap } from './tilemap.ts'

describe('tilemap.json', () => {
  it('describes the atlases the build script promises', () => {
    expect(TILEMAP.fps).toBe(24)
    expect(TILEMAP.seconds).toBe(4)
    expect(TILEMAP.video.desktop).toMatchObject({ width: 1920, height: 960, cols: 6, rows: 3, tile: 320, insetPx: 4, codec: 'avc1.4D4028' })
    expect(TILEMAP.video.mobile).toMatchObject({ width: 1152, height: 576, cols: 6, rows: 3, tile: 192, insetPx: 3, codec: 'avc1.4D401F' })
    expect(TILEMAP.stills.desktop).toMatchObject({ width: 2048, height: 2048, cols: 4, rows: 4 })
    expect(TILEMAP.stills.mobile).toMatchObject({ width: 1024, height: 1024, cols: 4, rows: 4 })
  })

  it('names only files that are shipped (imported through Vite)', () => {
    for (const cls of ['desktop', 'mobile'] as const) {
      const v = TILEMAP.video[cls]
      expect(mediaUrl(v.file)).toMatch(/atlas-(desktop|mobile)\.mp4/)
      expect(mediaUrl(v.frame0)).toMatch(/frame0-/)
      expect(mediaUrl(TILEMAP.stills[cls].file)).toMatch(/stills-/)
    }
    expect(() => mediaUrl('nope.mp4')).toThrow(/missing/)
  })

  it('stays inside the byte budgets (desktop ~3 MB, mobile ~1.2 MB)', () => {
    const total = (cls: 'desktop' | 'mobile') => TILEMAP.video[cls].bytes + TILEMAP.video[cls].frame0Bytes + TILEMAP.stills[cls].bytes
    expect(total('desktop')).toBeLessThanOrEqual(3_000_000)
    expect(total('mobile')).toBeLessThanOrEqual(1_200_000)
  })

  it('rejects a broken file', () => {
    const broken = structuredClone(tilemapJson) as Tilemap
    broken.video.desktop.width = 1000
    expect(() => checkTilemap(broken)).toThrow(/bad grid/)
    const old = { ...structuredClone(tilemapJson), version: 2 } as Tilemap
    expect(() => checkTilemap(old)).toThrow(/version/)
  })
})

describe('tileRect', () => {
  const grid = TILEMAP.video.desktop

  it('numbers tiles row-major from the top-left (v = 1 is the top row)', () => {
    expect(tileCount(grid)).toBe(18)
    const first = tileRect(grid, 0)
    expect(first.u0).toBeCloseTo(0)
    expect(first.v0).toBeCloseTo(2 / 3)
    expect(first.du).toBeCloseTo(1 / 6)
    expect(first.dv).toBeCloseTo(1 / 3)
    const seventh = tileRect(grid, 6)
    expect(seventh.u0).toBeCloseTo(0)
    expect(seventh.v0).toBeCloseTo(1 / 3)
    const last = tileRect(grid, 17)
    expect(last.u0).toBeCloseTo(5 / 6)
    expect(last.v0).toBeCloseTo(0)
    expect(tileRect(grid, 18)).toEqual(first)
  })

  it('turns the pixel inset into separate u and v insets on a 2:1 atlas', () => {
    const r = tileRect(grid, 3)
    expect(r.aspect).toBe(1)
    expect(r.inset).toBeCloseTo(4 / 1920)
    expect(r.insetV).toBeCloseTo(4 / 960)
    const m = tileRect(TILEMAP.video.mobile, 3)
    expect(m.inset).toBeCloseTo(3 / 1152)
    expect(m.insetV).toBeCloseTo(3 / 576)
  })

  it('keeps every shard’s cover UVs inside its own tile, at least insetPx from the edges', () => {
    const shards = makeShards({ width: 1600, height: 900, count: 120, seed: 20261005 })
    for (const [cls, atlas] of [['video', TILEMAP.video.desktop], ['stills', TILEMAP.stills.mobile]] as const) {
      shards.forEach((s, i) => {
        const r = tileRect(atlas, i)
        for (const p of s.polygon) {
          const [u, v] = coverUv(p, s, r)
          const px = u * atlas.width
          const py = v * atlas.height
          const left = r.u0 * atlas.width
          const bottom = r.v0 * atlas.height
          expect(px, cls).toBeGreaterThanOrEqual(left + atlas.insetPx - 1e-6)
          expect(px, cls).toBeLessThanOrEqual(left + atlas.tile - atlas.insetPx + 1e-6)
          expect(py, cls).toBeGreaterThanOrEqual(bottom + atlas.insetPx - 1e-6)
          expect(py, cls).toBeLessThanOrEqual(bottom + atlas.tile - atlas.insetPx + 1e-6)
        }
      })
    }
  })
})
