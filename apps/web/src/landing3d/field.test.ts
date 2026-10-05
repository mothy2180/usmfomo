import { describe, expect, it } from 'vitest'
import {
  axisAngle,
  FOG_FAR,
  FOG_NEAR,
  fogAmount,
  glint,
  isConvex,
  makeField,
  makeFieldShard,
  polygonArea,
  project,
  quatMul,
  recycle,
  rotatedNormal,
  rotateVec,
  worldPolygon,
  shardLook,
  shardShape,
  shouldRecycle,
  spawnPosition,
  SPREAD_DEPTH,
  stepShard,
  TileDeck,
  TUBE_X,
  TUBE_Y,
  viewHalfExtents,
  warpProfile,
  Z_FAR,
  Z_NEAR,
} from './field.ts'
import { mulberry32 } from './random.ts'

describe('shard shapes', () => {
  it('media facets are convex, counter-clockwise and poster-sized', () => {
    const rand = mulberry32(1)
    for (let i = 0; i < 200; i++) {
      const p = shardShape('media', rand)
      expect(p.length).toBeGreaterThanOrEqual(5)
      expect(p.length).toBeLessThanOrEqual(7)
      expect(isConvex(p)).toBe(true)
      expect(polygonArea(p)).toBeGreaterThan(0.4)
    }
  })

  it('clear shards are small convex fragments or slivers', () => {
    const rand = mulberry32(2)
    for (let i = 0; i < 200; i++) {
      const p = shardShape('clear', rand)
      expect(p.length).toBeGreaterThanOrEqual(3)
      expect(p.length).toBeLessThanOrEqual(5)
      expect(isConvex(p)).toBe(true)
      const xs = p.map((q) => q[0])
      const ys = p.map((q) => q[1])
      const w = Math.max(...xs) - Math.min(...xs)
      const h = Math.max(...ys) - Math.min(...ys)
      // Long and thin in some orientation.
      expect(Math.max(w, h) / Math.max(1e-6, Math.min(w, h))).toBeGreaterThan(1)
    }
  })
})

describe('spawning', () => {
  it('never places a shard inside the central tube (the title and button stay clear)', () => {
    const rand = mulberry32(3)
    for (const aspect of [16 / 9, 390 / 844]) {
      const [hw, hh] = viewHalfExtents(SPREAD_DEPTH, aspect)
      for (let i = 0; i < 2000; i++) {
        const [x, y, z] = spawnPosition(rand, aspect, Z_FAR, Z_NEAR - 2)
        expect(Math.abs(x) >= TUBE_X * hw || Math.abs(y) >= TUBE_Y * hh).toBe(true)
        expect(z).toBeGreaterThanOrEqual(Z_FAR)
        expect(z).toBeLessThanOrEqual(Z_NEAR - 2)
      }
    }
  })

  it('far shards gather towards the middle of the view; near ones spread past its edges', () => {
    const rand = mulberry32(13)
    const far = Array.from({ length: 400 }, () => project(spawnPosition(rand, 16 / 9, Z_FAR, Z_FAR + 1), 16 / 9)!)
    for (const [x, y] of far) {
      expect(Math.abs(x)).toBeLessThan(0.4)
      expect(Math.abs(y)).toBeLessThan(0.4)
    }
    const near = Array.from({ length: 400 }, () => project(spawnPosition(rand, 16 / 9, -4, -3), 16 / 9)!)
    const offscreen = near.filter(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1).length
    expect(offscreen / near.length).toBeGreaterThan(0.4)
  })

  it('initial field spans the whole depth; recycled shards re-enter far away', () => {
    const field = makeField({ media: 24, clear: 46, speed: 0.9 }, 16 / 9, 42)
    expect(field).toHaveLength(70)
    const zs = field.map((s) => s.position[2])
    expect(Math.min(...zs)).toBeLessThan(-22)
    expect(Math.max(...zs)).toBeGreaterThan(-10)
    const s = field[0]!
    s.position[2] = Z_NEAR + 0.1
    expect(shouldRecycle(s, 16 / 9)).toBe(true)
    recycle(s, mulberry32(9), { aspect: 16 / 9 })
    expect(s.position[2]).toBeLessThan(Z_FAR + 9)
    expect(shouldRecycle(s, 16 / 9)).toBe(false)
  })

  it('is deterministic for a seed', () => {
    const a = makeField({ media: 5, clear: 5, speed: 0.9 }, 1.5, 7)
    const b = makeField({ media: 5, clear: 5, speed: 0.9 }, 1.5, 7)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('a smaller plan is the start of a larger one, at the same screen positions on any aspect', () => {
    const big = makeField({ media: 24, clear: 80, speed: 0.8 }, 16 / 9, 7)
    const small = makeField({ media: 11, clear: 29, speed: 0.8 }, 390 / 844, 7)
    const bigMedia = big.filter((s) => s.kind === 'media').slice(0, 11)
    const bigClear = big.filter((s) => s.kind === 'clear').slice(0, 29)
    const smallMedia = small.filter((s) => s.kind === 'media')
    const smallClear = small.filter((s) => s.kind === 'clear')
    for (const [a, b] of [...bigMedia.map((s, i) => [s, smallMedia[i]!] as const), ...bigClear.map((s, i) => [s, smallClear[i]!] as const)]) {
      expect(b.polygon).toEqual(a.polygon)
      expect(b.position[2]).toBe(a.position[2])
      const pa = project(a.position, 16 / 9)!
      const pb = project(b.position, 390 / 844)!
      expect(pb[0]).toBeCloseTo(pa[0], 9)
      expect(pb[1]).toBeCloseTo(pa[1], 9)
    }
  })
})

describe('motion', () => {
  it('drifts towards the camera and keeps the orientation normalised', () => {
    const s = makeFieldShard('media', mulberry32(4), { aspect: 1.6 }, true)
    const z0 = s.position[2]
    for (let i = 0; i < 600; i++) stepShard(s, 1 / 60)
    expect(s.position[2]).toBeGreaterThan(z0) // 10 s later it is closer
    expect(s.position[2] - z0).toBeLessThan(20) // slow drift, not a fly-by
    expect(Math.hypot(...s.quat)).toBeCloseTo(1, 6)
  })

  it('the warp is much faster than the drift', () => {
    const a = makeFieldShard('clear', mulberry32(5), { aspect: 1.6 }, true)
    const b = structuredClone(a)
    stepShard(a, 0.1, 1)
    stepShard(b, 0.1, warpProfile(0.9).speedMul)
    expect(b.position[2] - a.position[2]).toBeGreaterThan(1)
  })

  it('media facets mostly face the viewer', () => {
    const rand = mulberry32(6)
    let facing = 0
    for (let i = 0; i < 300; i++) {
      const s = makeFieldShard('media', rand, { aspect: 1.6 }, true)
      if (Math.abs(rotatedNormal(s.quat)[2]) > 0.8) facing++
    }
    expect(facing / 300).toBeGreaterThan(0.85)
  })
})

describe('quaternions and glints', () => {
  it('rotates the face normal', () => {
    const q = axisAngle([1, 0, 0], Math.PI / 2)
    const n = rotatedNormal(q)
    expect(n[0]).toBeCloseTo(0)
    expect(n[1]).toBeCloseTo(-1)
    expect(n[2]).toBeCloseTo(0)
    const id = quatMul(q, [-q[0], -q[1], -q[2], q[3]])
    expect(id[3]).toBeCloseTo(1)
  })

  it('rotateVec agrees with rotatedNormal, and worldPolygon moves the outline', () => {
    const q = quatMul(axisAngle([0, 1, 0], 0.7), axisAngle([1, 0, 0], 0.3))
    const a = rotateVec(q, [0, 0, 1])
    const b = rotatedNormal(q)
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 9)
    const s = makeFieldShard('media', mulberry32(12), { aspect: 1.6 }, true)
    s.quat = [0, 0, 0, 1]
    const w = worldPolygon(s)
    expect(w[0]![0]).toBeCloseTo(s.polygon[0]![0] + s.position[0])
    expect(w[0]![2]).toBeCloseTo(s.position[2])
  })

  it('a glint peaks only near the mirror angle', () => {
    expect(glint([0, 0, 1])).toBeLessThan(0.75)
    const half = (() => {
      const l = [-0.5, 0.65, 0.6]
      const len = Math.hypot(...l)
      const h = [l[0]! / len, l[1]! / len, l[2]! / len + 1]
      const hl = Math.hypot(...h)
      return [h[0]! / hl, h[1]! / hl, h[2]! / hl] as [number, number, number]
    })()
    expect(glint(half)).toBeCloseTo(1, 5)
    expect(glint([1, 0, 0])).toBeLessThan(0.01)
  })
})

describe('look', () => {
  it('clear glass brightens as it turns edge-on and fades just before passing the camera', () => {
    const faceOn = shardLook('clear', [0, 0, 1], -10)
    const edgeOn = shardLook('clear', [1, 0, 0], -10)
    expect(edgeOn.faceOpacity).toBeGreaterThan(faceOn.faceOpacity)
    expect(shardLook('clear', [1, 0, 0], -1.6).faceOpacity).toBeCloseTo(0, 5)
    expect(shardLook('media', [0, 0, 1], -10, 0).faceOpacity).toBe(0)
  })

  it('fog grows with distance', () => {
    expect(fogAmount(-FOG_NEAR + 1)).toBe(0)
    expect(fogAmount(-FOG_FAR - 1)).toBe(1)
    expect(fogAmount(-18)).toBeGreaterThan(0)
    expect(fogAmount(-18)).toBeLessThan(1)
  })
})

describe('warp, deck, projection', () => {
  it('warp speeds up, widens the view and fades to black at the end', () => {
    expect(warpProfile(0).speedMul).toBe(1)
    expect(warpProfile(1).speedMul).toBeGreaterThan(20)
    expect(warpProfile(1).fov).toBeGreaterThan(warpProfile(0).fov)
    expect(warpProfile(0.4).fade).toBe(1)
    expect(warpProfile(1).fade).toBe(0)
  })

  it('the deck shows every tile before any repeats, never twice in a row', () => {
    const deck = new TileDeck(34, 11)
    let prev = -1
    for (let round = 0; round < 5; round++) {
      const seen = new Set<number>()
      for (let i = 0; i < 34; i++) {
        const t = deck.next()
        expect(t).not.toBe(prev)
        seen.add(t)
        prev = t
      }
      expect(seen.size).toBe(34)
    }
  })

  it('projects points in front of the camera only', () => {
    expect(project([0, 0, -10], 1.6)).toEqual([0, 0])
    expect(project([0, 0, 1], 1.6)).toBeNull()
    const p = project([2, 1, -4], 1.6)!
    expect(p[0]).toBeGreaterThan(0)
    expect(p[1]).toBeGreaterThan(0)
  })
})
