// What the landing scene looks like for the viewport it starts in. Pure (no
// DOM, no three.js), so tests, the placeholder generator and the eager landing
// page can use it without pulling in the lazy 3D chunk.

/** Same seed as scripts/gen-placeholder.ts, so the glass keeps its character
 * when the canvas fades in over the placeholder. */
export const SHARD_SEED = 20261005

export type DeviceClass = 'desktop' | 'mobile'

/** Viewports below this many CSS px² are phones (390x844 = 329k,
 * 430x932 = 401k); tablets and laptops (1280x720 = 922k) are desktop. */
export const MOBILE_MAX_AREA = 500_000
const MOBILE_MIN_AREA = 360 * 640
const DESKTOP_FULL_AREA = 1920 * 1080

export function deviceClass(width: number, height: number): DeviceClass {
  return width * height < MOBILE_MAX_AREA ? 'mobile' : 'desktop'
}

/** Highest device pixel ratio the canvas renders at. */
export const DPR_CAP: Readonly<Record<DeviceClass, number>> = { desktop: 1.75, mobile: 1.5 }

/** How fast the glass drifts towards the camera (world units per second). */
export const DRIFT_SPEED = 0.8

export type FieldPlan = {
  /** Larger facets showing the clips and posters. */
  media: number
  /** Clear glass splinters. */
  clear: number
  dprCap: number
  speed: number
}

export type ScenePlan = { cls: DeviceClass; seed: number; field: FieldPlan }

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))

/** Shard counts by viewport area: phones about 11 + 29, large screens 24 + 80. */
export function planField(width: number, height: number): FieldPlan {
  const area = Math.max(0, width) * Math.max(0, height)
  const t = (area - MOBILE_MIN_AREA) / (DESKTOP_FULL_AREA - MOBILE_MIN_AREA)
  return {
    media: Math.round(lerp(10, 24, t)),
    clear: Math.round(lerp(26, 80, t)),
    dprCap: DPR_CAP[deviceClass(width, height)],
    speed: DRIFT_SPEED,
  }
}

/** Everything about the scene that depends on the viewport it starts in. */
export function planScene(width: number, height: number): ScenePlan {
  return { cls: deviceClass(width, height), seed: SHARD_SEED, field: planField(width, height) }
}
