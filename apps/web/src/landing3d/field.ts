// The floating-shards field: glass shards drifting slowly towards and past the
// camera at many depths, tumbling gently, recycled far away once they pass —
// an endless slow-motion fly-through of shattered glass. Pure maths (no DOM,
// no three.js) so it is unit-tested and also drives the static placeholder
// (scripts/gen-placeholder.ts), which is a frozen frame of the same field.
//
// World units: the camera sits at the origin looking down -z (y up).
import type { FieldPlan } from './layout.ts'
import { mulberry32 } from './random.ts'

export type Vec3 = [number, number, number]
export type Point2 = [number, number]

export type ShardKind = 'media' | 'clear'

export const FOV_DEG = 55
export const Z_FAR = -30
/** A shard closer than this has passed the camera and is recycled. */
export const Z_NEAR = -1.4
/** Where recycled shards re-enter (a band at the far end). */
export const SPAWN_BAND = 6
/** No shard flies through this tube around the view axis, as shares of the
 * view at SPREAD_DEPTH: big near shards pass around the title and button,
 * never across them, while small far ones still gather towards the middle. */
export const TUBE_X = 0.22
export const TUBE_Y = 0.28
/** Distance fog (world units from the camera): shards emerge from the dark. */
export const FOG_NEAR = 6
export const FOG_FAR = 42
/** Shards are spread across the view as it is at this depth: farther away they
 * gather towards the middle, closer they spread past the edges (pass by). */
export const SPREAD_DEPTH = 10

export type FieldShard = {
  kind: ShardKind
  /** Convex polygon around (0,0), counter-clockwise, in world units. */
  polygon: Point2[]
  position: Vec3
  velocity: Vec3
  /** Unit rotation axis and speed (rad/s) of the slow tumble. */
  axis: Vec3
  spin: number
  /** Current orientation (a unit quaternion: x, y, z, w). */
  quat: [number, number, number, number]
}

export type FieldOptions = {
  /** Viewport aspect (width / height). */
  aspect: number
  /** Base drift speed towards the camera, world units per second. */
  speed?: number
}

const TAN_HALF_FOV = Math.tan(((FOV_DEG / 2) * Math.PI) / 180)

/** Half extents of the visible area at depth d (> 0) in front of the camera. */
export function viewHalfExtents(depth: number, aspect: number): Point2 {
  const h = depth * TAN_HALF_FOV
  return [h * Math.max(aspect, 0.2), h]
}

/** Convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: Point2[]): Point2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point2[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point2[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function convexPolygon(rand: () => number, sides: number, rx: number, ry: number): Point2[] {
  // Random angles around the circle, each vertex pushed in or out a little
  // (irregular, glass-like); the hull keeps it convex. Retry until the hull
  // still has the wanted number of sides.
  let best: Point2[] = []
  for (let attempt = 0; attempt < 12; attempt++) {
    const rot = rand() * Math.PI * 2
    const pts = Array.from({ length: sides }, (_, i) => {
      const a = ((i + 0.15 + rand() * 0.7) / sides) * Math.PI * 2 + rot
      const r = 0.82 + rand() * 0.3
      return [Math.cos(a) * rx * r, Math.sin(a) * ry * r] as Point2
    })
    const hull = convexHull(pts)
    if (hull.length === sides) return hull
    if (hull.length > best.length) best = hull
  }
  return best
}

/** Shape of a new shard. Media shards are poster-sized facets (5-7 sides);
 * clear shards are irregular fragments (3-5 sides) or long thin slivers. */
export function shardShape(kind: ShardKind, rand: () => number): Point2[] {
  if (kind === 'media') {
    const size = 0.65 + rand() * 0.75 // half-size 0.65..1.4 world units
    const stretch = 0.8 + rand() * 0.45
    return convexPolygon(rand, 5 + Math.floor(rand() * 3), size * stretch, size / stretch)
  }
  if (rand() < 0.6) {
    const size = 0.18 + rand() * 0.55
    const stretch = 0.7 + rand() * 0.8
    return convexPolygon(rand, 3 + Math.floor(rand() * 3), size * stretch, size / stretch)
  }
  const length = 0.3 + rand() * 0.8
  const width = 0.06 + rand() * 0.16
  return convexPolygon(rand, 3 + Math.floor(rand() * 2), length, width)
}

/** Signed area (positive = counter-clockwise). */
export function polygonArea(poly: Point2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!
    const [x1, y1] = poly[(i + 1) % poly.length]!
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function isConvex(poly: Point2[]): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!
    const [bx, by] = poly[(i + 1) % poly.length]!
    const [cx, cy] = poly[(i + 2) % poly.length]!
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cross) < 1e-12) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Quaternion for a rotation of `angle` about unit `axis`. */
export function axisAngle(axis: Vec3, angle: number): [number, number, number, number] {
  const s = Math.sin(angle / 2)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

/** Hamilton product a * b. */
export function quatMul(a: readonly number[], b: readonly number[]): [number, number, number, number] {
  const [ax, ay, az, aw] = a as [number, number, number, number]
  const [bx, by, bz, bw] = b as [number, number, number, number]
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** Rotate vector v by unit quaternion q (q v q*). */
export function rotateVec(q: readonly number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q as [number, number, number, number]
  // t = 2 * cross(q.xyz, v); v' = v + w t + cross(q.xyz, t)
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}

/** The shard's outline in world space (rotated, then moved to its position). */
export function worldPolygon(s: FieldShard): Vec3[] {
  return s.polygon.map(([px, py]) => {
    const r = rotateVec(s.quat, [px, py, 0])
    return [r[0] + s.position[0], r[1] + s.position[1], r[2] + s.position[2]] as Vec3
  })
}

/** The face normal (local +z) after rotation by quaternion q. */
export function rotatedNormal(q: readonly number[]): Vec3 {
  const [x, y, z, w] = q as [number, number, number, number]
  // Third column of the rotation matrix.
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]
}

/**
 * A point in the depth band [zMin, zMax], outside the central tube. Sideways
 * it is spread over the view at SPREAD_DEPTH whatever its depth, so a shard
 * keeps its course as it drifts in and the first frame already looks like
 * every later one.
 */
export function spawnPosition(rand: () => number, aspect: number, zMin: number, zMax: number): Vec3 {
  const z = zMin + rand() * (zMax - zMin)
  const [hw, hh] = viewHalfExtents(SPREAD_DEPTH, aspect)
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = (rand() * 2 - 1) * hw * 1.1
    const y = (rand() * 2 - 1) * hh * 1.1
    if (Math.abs(x) >= TUBE_X * hw || Math.abs(y) >= TUBE_Y * hh) return [x, y, z]
  }
  // Fallback: just outside the tube, above or below it.
  return [(rand() * 2 - 1) * hw, TUBE_Y * hh * (rand() < 0.5 ? -1 : 1), z]
}

export function makeFieldShard(kind: ShardKind, rand: () => number, opts: FieldOptions, initial: boolean): FieldShard {
  const speed = opts.speed ?? 0.9
  const zMax = initial ? Z_NEAR - 2 : Z_FAR + SPAWN_BAND
  const position = spawnPosition(rand, opts.aspect, Z_FAR, zMax)
  // Mostly towards the camera, with a little sideways drift.
  const vz = speed * (0.6 + rand() * 0.8) * (kind === 'clear' ? 1.15 : 1)
  const velocity: Vec3 = [(rand() * 2 - 1) * 0.06, (rand() * 2 - 1) * 0.05, vz]
  // Media facets mostly face the viewer (so their clip or poster reads) and
  // wobble; clear splinters tumble freely.
  const axis =
    kind === 'media'
      ? normalize([(rand() * 2 - 1) * 0.5, (rand() * 2 - 1) * 0.5, 1])
      : normalize([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1])
  const spin = (kind === 'media' ? 0.06 + rand() * 0.16 : 0.12 + rand() * 0.38) * (rand() < 0.5 ? -1 : 1)
  const tiltAxis = normalize([rand() * 2 - 1, rand() * 2 - 1, 0])
  const tilt = kind === 'media' ? (rand() * 2 - 1) * 0.45 : rand() * Math.PI * 2
  const quat = quatMul(axisAngle(tiltAxis, tilt), axisAngle([0, 0, 1], rand() * Math.PI * 2))
  return { kind, polygon: shardShape(kind, rand), position, velocity, axis, spin, quat }
}

/** Advance one shard by dt seconds; speedMul > 1 during the warp. */
export function stepShard(s: FieldShard, dt: number, speedMul = 1): void {
  s.position[0] += s.velocity[0] * dt
  s.position[1] += s.velocity[1] * dt
  s.position[2] += s.velocity[2] * dt * speedMul
  const dq = axisAngle(s.axis, s.spin * dt * (speedMul > 1 ? 1 + (speedMul - 1) * 0.15 : 1))
  const q = quatMul(dq, s.quat)
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  s.quat = [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/** True once the shard has passed the camera or drifted well out of view. */
export function shouldRecycle(s: FieldShard, aspect: number): boolean {
  const z = s.position[2]
  if (z > Z_NEAR) return true
  const [hw, hh] = viewHalfExtents(-z, aspect)
  return Math.abs(s.position[0]) > hw * 1.6 + 2 || Math.abs(s.position[1]) > hh * 1.6 + 2
}

/** Re-enter a recycled shard at the far end, with a new shape and motion. */
export function recycle(s: FieldShard, rand: () => number, opts: FieldOptions): void {
  const next = makeFieldShard(s.kind, rand, opts, false)
  s.polygon = next.polygon
  s.position = next.position
  s.velocity = next.velocity
  s.axis = next.axis
  s.spin = next.spin
  s.quat = next.quat
}

/** Light and view for the glints: light from the upper left, viewer on +z. */
export const LIGHT_DIR: Vec3 = normalize([-0.5, 0.65, 0.6])
const HALF: Vec3 = normalize([LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2] + 1])

/** 0..1 specular glint for a facet with this (unit) normal; double-sided. */
export function glint(normal: Vec3, sharpness = 10): number {
  const d = Math.abs(normal[0] * HALF[0] + normal[1] * HALF[1] + normal[2] * HALF[2])
  return d ** sharpness
}

/** 0 near the camera .. 1 far away (matches three's linear Fog). */
export function fogAmount(z: number): number {
  return Math.min(1, Math.max(0, (-z - FOG_NEAR) / (FOG_FAR - FOG_NEAR)))
}

/** 1 until the last few units before a shard passes the camera, then down to 0. */
export function nearFade(z: number): number {
  const t = Math.min(1, Math.max(0, (z + 4.2) / (4.2 - 1.6)))
  return 1 - t * t * (3 - 2 * t)
}

export type ShardLook = { faceOpacity: number; edgeOpacity: number; glowOpacity: number; brightness: number }

/**
 * How bright a shard looks for its orientation: glass reflects more as it
 * turns edge-on (a cheap Fresnel term) and flashes at the mirror angle (the
 * glint). Shared by the live scene and the static placeholder.
 */
export function shardLook(kind: ShardKind, normal: Vec3, z: number, fade = 1): ShardLook {
  const g = glint(normal)
  const facing = Math.abs(normal[2])
  const fresnel = (1 - facing) ** 1.5
  const k = nearFade(z) * fade
  if (kind === 'media') {
    return {
      faceOpacity: 0.94 * k,
      brightness: (0.84 + 0.16 * g) * fade,
      glowOpacity: (0.12 * fresnel + 0.45 * g) * k,
      edgeOpacity: (0.4 + 0.25 * fresnel + 0.35 * g) * k,
    }
  }
  return {
    faceOpacity: (0.2 + 0.3 * fresnel + 0.5 * g) * k,
    brightness: fade,
    glowOpacity: 0,
    edgeOpacity: (0.55 + 0.3 * fresnel + 0.3 * g) * k,
  }
}

/** How the "I'm FOMO" warp evolves over t = 0..1: speed, field of view, fade. */
export function warpProfile(t: number): { speedMul: number; fov: number; fade: number } {
  const c = Math.min(1, Math.max(0, t))
  const ease = c * c * (3 - 2 * c)
  const fadeT = Math.min(1, Math.max(0, (c - 0.55) / 0.45))
  return { speedMul: 1 + 34 * c * c, fov: FOV_DEG + 14 * ease, fade: c >= 1 ? 0 : 1 - fadeT * fadeT }
}

/** Shuffled endless deck of media tiles: no tile repeats until all have shown. */
export class TileDeck {
  private readonly rand: () => number
  private readonly size: number
  private order: number[] = []
  private last = -1

  constructor(size: number, seed: number) {
    this.size = Math.max(1, size)
    this.rand = mulberry32(seed)
  }

  next(): number {
    if (this.order.length === 0) {
      this.order = Array.from({ length: this.size }, (_, i) => i)
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1))
        ;[this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!]
      }
      // Never the same tile twice in a row across a reshuffle.
      if (this.size > 1 && this.order[this.order.length - 1] === this.last) {
        const a = this.order.length - 1
        ;[this.order[0], this.order[a]] = [this.order[a]!, this.order[0]!]
      }
    }
    const tile = this.order.pop()!
    this.last = tile
    return tile
  }
}

/** Perspective projection to normalised device coordinates (-1..1, y up). */
export function project(p: Vec3, aspect: number, fovDeg = FOV_DEG): Point2 | null {
  const depth = -p[2]
  if (depth <= 0.05) return null
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180)
  return [p[0] / (depth * t * aspect), p[1] / (depth * t)]
}

/** Initial field: every shard spread over the whole depth so the view is full from the first frame. */
export function makeField(plan: Pick<FieldPlan, 'media' | 'clear' | 'speed'>, aspect: number, seed: number): FieldShard[] {
  const rand = mulberry32(seed)
  const opts = { aspect, speed: plan.speed }
  const shards: FieldShard[] = []
  for (let i = 0; i < plan.media; i++) shards.push(makeFieldShard('media', rand, opts, true))
  for (let i = 0; i < plan.clear; i++) shards.push(makeFieldShard('clear', rand, opts, true))
  return shards
}
