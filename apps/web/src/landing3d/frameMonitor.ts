// A small frame-time monitor (instead of drei's PerformanceMonitor). The scene
// renders on demand, so it only reports intervals while it wants frames back to
// back (video playing, pointer easing). Once per window the monitor answers
// 'ok' or 'slow'; the scene then lowers its pixel ratio, and at the floor falls
// back to the placeholder.

export type MonitorOptions = {
  /** Samples per verdict. */
  window: number
  /** Average interval above which the window counts as slow. 55 ms (~18 fps)
   * tolerates a 30 fps cap (Low Power Mode) and the 24 fps video cadence. */
  slowMs: number
  /** Samples ignored after a start or reset (shader compile, texture upload). */
  warmup: number
  /** Longer gaps are not frame times and are dropped: a background tab, a
   * debugger, or a window that is covered but not hidden, which browsers
   * throttle to about one frame a second. A device really this slow is
   * still caught by its other frames (they clamp to CLAMP_MS). */
  maxSampleMs: number
}

export const MONITOR_DEFAULTS: MonitorOptions = { window: 30, slowMs: 55, warmup: 10, maxSampleMs: 400 }

/** One long frame (GC, a busy main thread) must not decide a window alone. */
const CLAMP_MS = 250

export class FrameMonitor {
  private readonly opts: MonitorOptions
  private samples: number[] = []
  private skip: number

  constructor(opts: Partial<MonitorOptions> = {}) {
    this.opts = { ...MONITOR_DEFAULTS, ...opts }
    this.skip = this.opts.warmup
  }

  /** Feed one frame interval (ms). Returns null while a window is filling. */
  sample(dt: number): 'ok' | 'slow' | null {
    if (!(dt > 0) || dt > this.opts.maxSampleMs) return null
    if (this.skip > 0) {
      this.skip--
      return null
    }
    this.samples.push(Math.min(dt, CLAMP_MS))
    if (this.samples.length < this.opts.window) return null
    const avg = this.samples.reduce((sum, v) => sum + v, 0) / this.samples.length
    this.samples = []
    return avg > this.opts.slowMs ? 'slow' : 'ok'
  }

  /** Start over, e.g. after a pixel-ratio change or when the tab comes back. */
  reset(warmup = this.opts.warmup): void {
    this.samples = []
    this.skip = warmup
  }
}

/** Next lower pixel ratio after a slow window, or null at the floor (fall back). */
export function nextDpr(current: number, floor = 1, step = 0.8): number | null {
  if (current <= floor + 1e-3) return null
  return Math.max(floor, Math.round(current * step * 100) / 100)
}
