import { describe, expect, it } from 'vitest'
import { coverView, deviceClass, planScene, SCENE_H, SCENE_W, shardCount, toWorld, viewToScene } from './layout.ts'

describe('device class and shard count', () => {
  it('treats phones as mobile and tablets/laptops as desktop', () => {
    expect(deviceClass(390, 844)).toBe('mobile')
    expect(deviceClass(844, 390)).toBe('mobile')
    expect(deviceClass(430, 932)).toBe('mobile')
    expect(deviceClass(768, 1024)).toBe('desktop')
    expect(deviceClass(1280, 720)).toBe('desktop')
  })

  it('gives phones 35-45 shards and larger screens 100-140, growing with area', () => {
    const sizes: [number, number][] = [[320, 568], [360, 640], [390, 844], [430, 932], [600, 830]]
    const phones = sizes.map(([w, h]) => shardCount(w, h))
    for (const n of phones) expect(n).toBeGreaterThanOrEqual(35)
    for (const n of phones) expect(n).toBeLessThanOrEqual(45)
    expect([...phones].sort((a, b) => a - b)).toEqual(phones)

    const screens = [shardCount(1024, 600), shardCount(1280, 720), shardCount(1440, 900), shardCount(1920, 1080), shardCount(3840, 2160)]
    for (const n of screens) expect(n).toBeGreaterThanOrEqual(100)
    for (const n of screens) expect(n).toBeLessThanOrEqual(140)
    expect(screens.at(-1)).toBe(140)
    expect([...screens].sort((a, b) => a - b)).toEqual(screens)
  })

  it('plans DPR caps and crack gaps per class', () => {
    expect(planScene(1440, 900)).toMatchObject({ cls: 'desktop', dprCap: 1.75 })
    expect(planScene(390, 844)).toMatchObject({ cls: 'mobile', dprCap: 1.5 })
  })
})

describe('cover view', () => {
  it('crops top and bottom on wide screens', () => {
    const v = coverView(2400, 900)
    expect(v.right - v.left).toBeCloseTo(SCENE_W)
    expect(v.top - v.bottom).toBeCloseTo(SCENE_W / (2400 / 900))
  })

  it('crops the sides on tall screens and keeps the aspect ratio', () => {
    const v = coverView(390, 844)
    expect(v.top - v.bottom).toBeCloseTo(SCENE_H)
    expect((v.right - v.left) / (v.top - v.bottom)).toBeCloseTo(390 / 844)
  })

  it('maps the canvas centre to the scene centre and corners to the visible edges', () => {
    const v = coverView(390, 844)
    expect(viewToScene(0.5, 0.5, v)).toEqual([SCENE_W / 2, SCENE_H / 2])
    const [x0, y0] = viewToScene(0, 0, v)
    expect(x0).toBeCloseTo(SCENE_W / 2 + v.left)
    expect(y0).toBeCloseTo(0)
    expect(toWorld(SCENE_W / 2, SCENE_H / 2)).toEqual([0, 0])
    expect(toWorld(0, 0)).toEqual([-SCENE_W / 2, SCENE_H / 2])
  })
})
