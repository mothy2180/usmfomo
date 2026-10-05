// Scene geometry for the shattered-glass landing scene. Pure (no DOM, no
// three.js), so tests and the eager landing page can use it without pulling
// in the lazy 3D chunk.

/** The virtual scene: 1600 x 900 units, fitted to the viewport like
 * object-fit: cover (the same box as public/landing/placeholder.svg). */
export const SCENE_W = 1600
export const SCENE_H = 900

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

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))

/** Shard count by viewport area: phones 35-45, larger screens 100-140. */
export function shardCount(width: number, height: number): number {
  const area = Math.max(0, width) * Math.max(0, height)
  if (area < MOBILE_MAX_AREA) {
    return Math.round(lerp(35, 45, (area - MOBILE_MIN_AREA) / (MOBILE_MAX_AREA - MOBILE_MIN_AREA)))
  }
  return Math.round(lerp(100, 140, (area - MOBILE_MAX_AREA) / (DESKTOP_FULL_AREA - MOBILE_MAX_AREA)))
}

/** Highest device pixel ratio the canvas renders at. */
export const DPR_CAP: Readonly<Record<DeviceClass, number>> = { desktop: 1.75, mobile: 1.5 }

/** Each shard is shrunk by this many scene units so dark gaps read as cracks. */
export const CRACK_INSET: Readonly<Record<DeviceClass, number>> = { desktop: 2.2, mobile: 2.6 }

export type ScenePlan = { cls: DeviceClass; count: number; dprCap: number; crackInset: number; seed: number }

/** Everything about the scene that depends on the viewport it starts in. */
export function planScene(width: number, height: number): ScenePlan {
  const cls = deviceClass(width, height)
  return { cls, count: shardCount(width, height), dprCap: DPR_CAP[cls], crackInset: CRACK_INSET[cls], seed: SHARD_SEED }
}

/** Visible part of the scene in world units (origin at the scene centre, y up). */
export type ViewRect = { left: number; right: number; top: number; bottom: number }

/** The orthographic camera's frustum: the scene covers the viewport like
 * object-fit: cover, so wide screens crop top/bottom and tall ones the sides. */
export function coverView(viewW: number, viewH: number): ViewRect {
  const sceneAspect = SCENE_W / SCENE_H
  const aspect = viewW > 0 && viewH > 0 ? viewW / viewH : sceneAspect
  const w = aspect > sceneAspect ? SCENE_W : SCENE_H * aspect
  const h = aspect > sceneAspect ? SCENE_W / aspect : SCENE_H
  return { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 }
}

/** Scene coordinates (origin top-left, y down) to world (origin centre, y up). */
export function toWorld(x: number, y: number): [number, number] {
  return [x - SCENE_W / 2, SCENE_H / 2 - y]
}

/** A point on the canvas, given as fractions of its box (0..1 from the
 * top-left), to scene coordinates. */
export function viewToScene(fx: number, fy: number, view: ViewRect): [number, number] {
  const wx = view.left + fx * (view.right - view.left)
  const wy = view.top - fy * (view.top - view.bottom)
  return [wx + SCENE_W / 2, SCENE_H / 2 - wy]
}
