// The "I'm FOMO" explosion as pure functions of time, so the timing and easing
// are unit-tested and the scene only applies the poses. Units are scene units
// (1600 x 900, y down); t runs from 0 to 1 over the whole explosion.
import type { Point } from './shards.ts'

/** Length of the explosion; LandingPage navigates when it ends. */
export const EXPLODE_MS = 800

/** The farthest shard leaves this share of the duration after the nearest. */
export const MAX_DELAY = 0.22

export type ShardMotion = {
  /** Unit direction away from the origin (scene axes, y down). */
  dirX: number
  dirY: number
  /** Start, as a share of the explosion (0 = at once). */
  delay: number
  /** Distance travelled by the end, in scene units (well past any viewport edge). */
  travel: number
  /** How strongly the shard flies towards the viewer (scale and z). */
  lift: number
  spinX: number
  spinY: number
  spinZ: number
}

export type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; scale: number }

export const IDENTITY_POSE: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
export const easeOutCubic = (x: number): number => 1 - (1 - clamp01(x)) ** 3
export const easeInQuad = (x: number): number => clamp01(x) ** 2

/** Per-shard motion for an explosion centred on `origin` (where the click was). */
export function planExplosion(shards: ReadonlyArray<{ centroid: Point }>, origin: Point, rand: () => number): ShardMotion[] {
  const dist = shards.map((s) => Math.hypot(s.centroid[0] - origin[0], s.centroid[1] - origin[1]))
  const maxDist = Math.max(1, ...dist)
  return shards.map((s, i) => {
    const d = dist[i] ?? 0
    let dirX = s.centroid[0] - origin[0]
    let dirY = s.centroid[1] - origin[1]
    if (d < 1e-6) {
      const a = rand() * Math.PI * 2
      dirX = Math.cos(a)
      dirY = Math.sin(a)
    } else {
      dirX /= d
      dirY /= d
    }
    const near = 1 - d / maxDist
    return {
      dirX,
      dirY,
      delay: (d / maxDist) * MAX_DELAY,
      travel: 1150 + 450 * rand(),
      lift: 0.35 + 0.9 * near * (0.6 + 0.4 * rand()),
      spinX: (rand() * 2 - 1) * 2.4,
      spinY: (rand() * 2 - 1) * 2.4,
      spinZ: (rand() * 2 - 1) * 1.6,
    }
  })
}

/** Share of its own flight a shard has completed at explosion time t. */
export function localProgress(t: number, delay: number): number {
  return delay >= 1 ? (t >= 1 ? 1 : 0) : clamp01((t - delay) / (1 - delay))
}

/** Offset of one shard from its resting pose at explosion time t. */
export function shardPose(t: number, m: ShardMotion): Pose {
  const p = localProgress(t, m.delay)
  if (p <= 0) return IDENTITY_POSE
  const e = easeOutCubic(p)
  // A fast kick (ease-out) that keeps accelerating out of view (ease-in).
  const travel = m.travel * (0.45 * e + 0.55 * easeInQuad(p))
  return {
    x: m.dirX * travel,
    y: m.dirY * travel,
    z: 600 * m.lift * e,
    rx: m.spinX * e,
    ry: m.spinY * e,
    rz: m.spinZ * e,
    scale: 1 + m.lift * e,
  }
}

/** Brightness of the whole scene: full for the first half, then down to black,
 * which hands over smoothly to the dark dashboard. */
export function explosionFade(t: number): number {
  const k = clamp01((t - 0.5) / 0.5)
  return 1 - k * k
}
