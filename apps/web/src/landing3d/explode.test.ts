import { describe, expect, it } from 'vitest'
import {
  easeInQuad,
  easeOutCubic,
  EXPLODE_MS,
  explosionFade,
  IDENTITY_POSE,
  localProgress,
  MAX_DELAY,
  planExplosion,
  shardPose,
} from './explode.ts'
import { coverView, SCENE_H, SCENE_W } from './layout.ts'
import { makeShards, mulberry32, type Point } from './shards.ts'

const shards = makeShards({ width: SCENE_W, height: SCENE_H, count: 130, seed: 20261005 })
const origin: Point = [SCENE_W / 2, SCENE_H * 0.56]
const motions = planExplosion(shards, origin, mulberry32(7))

describe('easing', () => {
  it('runs from 0 to 1, monotonically, and clamps outside [0, 1]', () => {
    for (const ease of [easeOutCubic, easeInQuad]) {
      expect(ease(0)).toBe(0)
      expect(ease(1)).toBe(1)
      expect(ease(-1)).toBe(0)
      expect(ease(2)).toBe(1)
      let prev = 0
      for (let x = 0; x <= 1.0001; x += 0.05) {
        expect(ease(x)).toBeGreaterThanOrEqual(prev)
        prev = ease(x)
      }
    }
    // Ease-out moves most at the start: a burst.
    expect(easeOutCubic(0.2)).toBeGreaterThan(0.45)
  })

  it('lasts about 800 ms', () => {
    expect(EXPLODE_MS).toBe(800)
  })
})

describe('planExplosion', () => {
  it('sends shards away from the click, nearer ones first', () => {
    shards.forEach((s, i) => {
      const m = motions[i]!
      const dx = s.centroid[0] - origin[0]
      const dy = s.centroid[1] - origin[1]
      expect(Math.hypot(m.dirX, m.dirY)).toBeCloseTo(1)
      expect(m.dirX * dx + m.dirY * dy).toBeGreaterThanOrEqual(0)
      expect(m.delay).toBeGreaterThanOrEqual(0)
      expect(m.delay).toBeLessThanOrEqual(MAX_DELAY)
    })
    const byDistance = shards
      .map((s, i) => ({ d: Math.hypot(s.centroid[0] - origin[0], s.centroid[1] - origin[1]), delay: motions[i]!.delay }))
      .sort((a, b) => a.d - b.d)
    for (let i = 1; i < byDistance.length; i++) expect(byDistance[i]!.delay).toBeGreaterThanOrEqual(byDistance[i - 1]!.delay)
  })

  it('handles a shard sitting exactly on the origin', () => {
    const [m] = planExplosion([{ centroid: origin }], origin, mulberry32(1))
    expect(Math.hypot(m!.dirX, m!.dirY)).toBeCloseTo(1)
  })

  it('is deterministic for a seed', () => {
    expect(planExplosion(shards, origin, mulberry32(7))).toEqual(motions)
  })
})

describe('shardPose', () => {
  it('starts at rest and waits for each shard’s delay', () => {
    for (const m of motions) expect(shardPose(0, m)).toEqual(IDENTITY_POSE)
    const late = motions.find((m) => m.delay > 0.1)!
    expect(shardPose(late.delay / 2, late)).toEqual(IDENTITY_POSE)
    expect(localProgress(late.delay, late.delay)).toBe(0)
    expect(localProgress(1, late.delay)).toBe(1)
  })

  it('moves every shard further out over time', () => {
    for (const m of motions) {
      let prev = 0
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const p = shardPose(t, m)
        const r = Math.hypot(p.x, p.y)
        expect(r).toBeGreaterThanOrEqual(prev - 1e-9)
        expect(p.scale).toBeGreaterThanOrEqual(1)
        prev = r
      }
      expect(prev).toBeCloseTo(m.travel)
    }
  })

  it('clears the view by the end, on wide and tall screens', () => {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      const v = coverView(w, h)
      const visible = shards.filter((s, i) => {
        const p = shardPose(1, motions[i]!)
        const cx = s.centroid[0] - SCENE_W / 2 + p.x
        const cy = SCENE_H / 2 - s.centroid[1] - p.y
        const r = Math.max(...s.polygon.map(([x, y]) => Math.hypot(x - s.centroid[0], y - s.centroid[1]))) * p.scale
        return cx + r > v.left && cx - r < v.right && cy + r > v.bottom && cy - r < v.top
      })
      expect(visible.length).toBe(0)
    }
  })
})

describe('explosionFade', () => {
  it('holds full brightness for the first half, then fades to black', () => {
    expect(explosionFade(0)).toBe(1)
    expect(explosionFade(0.5)).toBe(1)
    expect(explosionFade(0.75)).toBeCloseTo(0.75)
    expect(explosionFade(1)).toBe(0)
    let prev = 1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      expect(explosionFade(t)).toBeLessThanOrEqual(prev)
      prev = explosionFade(t)
    }
  })
})
