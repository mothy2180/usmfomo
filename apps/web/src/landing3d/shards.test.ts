import { describe, expect, it } from 'vitest'
import { assignTiles, coverUv, insetPolygon, makeShards, mulberry32, polygonCentroid } from './shards.ts'

describe('shards', () => {
  const opts = { width: 1600, height: 900, count: 120, seed: 42 }

  it('is deterministic for a seed', () => {
    const a = makeShards(opts)
    const b = makeShards(opts)
    expect(a.length).toBeGreaterThan(100)
    expect(JSON.stringify(a.slice(0, 5))).toBe(JSON.stringify(b.slice(0, 5)))
  })

  it('covers the visible area (every point of a grid falls in some shard bbox)', () => {
    const shards = makeShards(opts)
    for (let x = 0; x <= 1600; x += 200) {
      for (let y = 0; y <= 900; y += 150) {
        expect(shards.some((s) => x >= s.bbox.x0 && x <= s.bbox.x1 && y >= s.bbox.y0 && y <= s.bbox.y1)).toBe(true)
      }
    }
  })

  it('packs shards more densely near the impact point', () => {
    const shards = makeShards(opts)
    const area = (s: (typeof shards)[number]) => (s.bbox.x1 - s.bbox.x0) * (s.bbox.y1 - s.bbox.y0)
    const near = shards.filter((s) => s.distance < 0.25)
    const far = shards.filter((s) => s.distance > 0.75)
    const avg = (xs: typeof shards) => xs.reduce((t, s) => t + area(s), 0) / xs.length
    expect(avg(near)).toBeLessThan(avg(far))
  })

  it('never gives neighbouring shards the same tile when there are enough tiles', () => {
    const shards = makeShards(opts)
    const tiles = assignTiles(shards, 18)
    for (const s of shards) {
      for (const n of s.neighbors) {
        if (tiles.has(n)) expect(tiles.get(n)).not.toBe(tiles.get(s.index))
      }
    }
  })

  it('cover UVs stay inside the inset tile', () => {
    const shards = makeShards(opts)
    const tile = { u0: 0.5, v0: 0.25, du: 1 / 6, dv: 1 / 3, aspect: 1, inset: 0.002 }
    for (const s of shards.slice(0, 20)) {
      for (const p of s.polygon) {
        const [u, v] = coverUv(p, s, tile)
        expect(u).toBeGreaterThanOrEqual(tile.u0 + tile.inset)
        expect(u).toBeLessThanOrEqual(tile.u0 + tile.du - tile.inset)
        expect(v).toBeGreaterThanOrEqual(tile.v0 + tile.inset)
        expect(v).toBeLessThanOrEqual(tile.v0 + tile.dv - tile.inset)
      }
    }
  })

  it('cover UVs honour a separate v inset (non-square atlases)', () => {
    const shards = makeShards(opts)
    const tile = { u0: 0, v0: 2 / 3, du: 1 / 6, dv: 1 / 3, aspect: 1, inset: 4 / 1920, insetV: 4 / 960 }
    for (const s of shards.slice(0, 20)) {
      for (const p of s.polygon) {
        const [u, v] = coverUv(p, s, tile)
        expect(u).toBeGreaterThanOrEqual(tile.u0 + tile.inset)
        expect(u).toBeLessThanOrEqual(tile.u0 + tile.du - tile.inset)
        expect(v).toBeGreaterThanOrEqual(tile.v0 + tile.insetV)
        expect(v).toBeLessThanOrEqual(tile.v0 + tile.dv - tile.insetV)
      }
    }
    // Without insetV the v inset equals the u inset, as before.
    const s = shards[0]!
    const p = s.polygon[0]!
    expect(coverUv(p, s, { ...tile, insetV: undefined })).toEqual(coverUv(p, s, { ...tile, insetV: tile.inset }))
  })

  it('insets polygons towards the centroid', () => {
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    const c = polygonCentroid(square)
    expect(c).toEqual([5, 5])
    const inner = insetPolygon(square, c, 1)
    expect(inner[0]![0]).toBeGreaterThan(0)
    expect(inner[0]![1]).toBeGreaterThan(0)
  })

  it('mulberry32 is in [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
