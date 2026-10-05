import { describe, expect, it } from 'vitest'
import { FrameMonitor, nextDpr } from './frameMonitor.ts'

/** Feeds `n` samples of `dt` ms and returns the verdicts that came out. */
function feed(m: FrameMonitor, dt: number, n: number): ('ok' | 'slow')[] {
  const out: ('ok' | 'slow')[] = []
  for (let i = 0; i < n; i++) {
    const v = m.sample(dt)
    if (v) out.push(v)
  }
  return out
}

describe('FrameMonitor', () => {
  it('ignores the warm-up, then answers once per window', () => {
    const m = new FrameMonitor({ window: 30, warmup: 10 })
    expect(feed(m, 16.7, 39)).toEqual([])
    expect(m.sample(16.7)).toBe('ok')
  })

  it('accepts 60 fps, a 30 fps cap and the 24 fps video cadence', () => {
    for (const dt of [8.3, 16.7, 33.3, 41.7]) {
      expect(feed(new FrameMonitor({ warmup: 0 }), dt, 90)).toEqual(['ok', 'ok', 'ok'])
    }
  })

  it('calls ~15 fps slow', () => {
    expect(feed(new FrameMonitor({ warmup: 0 }), 66, 30)).toEqual(['slow'])
  })

  it('does not let one long frame decide a window', () => {
    const m = new FrameMonitor({ warmup: 0 })
    feed(m, 16.7, 29)
    expect(m.sample(390)).toBe('ok')
  })

  it('drops gaps that are not frame times (hidden tab, debugger, a covered window at 1 fps)', () => {
    const m = new FrameMonitor({ warmup: 0 })
    expect(feed(m, 5000, 100)).toEqual([])
    expect(feed(m, 1000, 300)).toEqual([])
    expect(feed(m, 0, 10)).toEqual([])
    expect(feed(m, Number.NaN, 10)).toEqual([])
  })

  it('still calls a device at 3 fps slow', () => {
    expect(feed(new FrameMonitor({ warmup: 0 }), 330, 30)).toEqual(['slow'])
  })

  it('starts over after a reset', () => {
    const m = new FrameMonitor({ warmup: 0 })
    feed(m, 80, 29)
    m.reset(5)
    expect(feed(m, 16.7, 34)).toEqual([])
    expect(m.sample(16.7)).toBe('ok')
  })
})

describe('nextDpr', () => {
  it('steps the pixel ratio down to the floor, then asks for the fallback', () => {
    const steps: number[] = []
    let dpr: number | null = 1.75
    while (dpr !== null) {
      steps.push(dpr)
      dpr = nextDpr(dpr, 1)
    }
    expect(steps).toEqual([1.75, 1.4, 1.12, 1])
    expect(nextDpr(1, 1)).toBeNull()
    expect(nextDpr(1.5, 1)).toBe(1.2)
  })
})
