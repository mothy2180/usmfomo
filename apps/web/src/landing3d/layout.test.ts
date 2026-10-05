import { describe, expect, it } from 'vitest'
import { deviceClass, planField, planScene, SHARD_SEED } from './layout.ts'

describe('device class and shard counts', () => {
  it('treats phones as mobile and tablets/laptops as desktop', () => {
    expect(deviceClass(390, 844)).toBe('mobile')
    expect(deviceClass(844, 390)).toBe('mobile')
    expect(deviceClass(430, 932)).toBe('mobile')
    expect(deviceClass(768, 1024)).toBe('desktop')
    expect(deviceClass(1280, 720)).toBe('desktop')
  })

  it('gives phones about 40 shards and large screens 104, growing with area', () => {
    const total = (w: number, h: number) => {
      const p = planField(w, h)
      return p.media + p.clear
    }
    const phones = [total(320, 568), total(360, 640), total(390, 844), total(430, 932)]
    for (const n of phones) expect(n).toBeGreaterThanOrEqual(36)
    for (const n of phones) expect(n).toBeLessThanOrEqual(42)
    const screens = [total(1024, 600), total(1280, 720), total(1440, 900), total(1920, 1080), total(3840, 2160)]
    const all = [...phones, ...screens]
    expect(all.toSorted((a, b) => a - b)).toEqual(all)
    expect(total(1920, 1080)).toBe(104)
    expect(total(3840, 2160)).toBe(104)
    // About a quarter are media facets.
    const desktop = planField(1920, 1080)
    expect(desktop.media / (desktop.media + desktop.clear)).toBeCloseTo(0.23, 1)
  })

  it('plans DPR caps per class and a slow drift', () => {
    expect(planScene(1440, 900)).toMatchObject({ cls: 'desktop', seed: SHARD_SEED, field: { dprCap: 1.75 } })
    expect(planScene(390, 844)).toMatchObject({ cls: 'mobile', field: { dprCap: 1.5 } })
    expect(planField(390, 844).speed).toBeLessThan(1.2)
  })
})
