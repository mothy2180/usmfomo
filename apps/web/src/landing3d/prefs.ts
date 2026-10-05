// The landing page's motion controls, remembered per browser. Storage can be
// blocked (private mode, browser policies), so every access is guarded and the
// page falls back to the defaults.

export type MotionPref = 'paused' | 'playing'
export type LitePref = 'on' | 'off'
/** null = the visitor never pressed that toggle (the defaults apply). */
export type StoredPrefs = { motion: MotionPref | null; lite: LitePref | null }

export const MOTION_KEY = 'usmfomo.landing.motion'
export const LITE_KEY = 'usmfomo.landing.lite'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Blocked storage: the choice still applies to this visit.
  }
}

export function readStoredPrefs(): StoredPrefs {
  const motion = read(MOTION_KEY)
  const lite = read(LITE_KEY)
  return {
    motion: motion === 'paused' || motion === 'playing' ? motion : null,
    lite: lite === 'on' || lite === 'off' ? lite : null,
  }
}

export function writeMotionPref(value: MotionPref): void {
  write(MOTION_KEY, value)
}

export function writeLitePref(value: LitePref): void {
  write(LITE_KEY, value)
}
