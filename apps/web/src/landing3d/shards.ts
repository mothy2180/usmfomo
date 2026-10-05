// Shattered-glass geometry: seeded Voronoi cells, denser around an "impact
// point" under the I'm FOMO button. Pure data (no DOM, no three.js) so the same
// code drives the static SVG placeholder (scripts/gen-placeholder.ts) and the
// 3D scene, and can be unit-tested.
import { Delaunay } from 'd3-delaunay'

export type Point = [number, number]

export type Shard = {
  index: number
  /** Closed convex polygon without the repeated last point, in scene units. */
  polygon: Point[]
  centroid: Point
  bbox: { x0: number; y0: number; x1: number; y1: number }
  neighbors: number[]
  /** Distance from the impact point, 0..1 (1 = farthest shard). */
  distance: number
}

export type ShardOptions = {
  width: number
  height: number
  count: number
  seed: number
  /** Impact point in scene units (defaults to slightly below centre). */
  impact?: Point
  /** Share of points placed radially around the impact (rest are uniform). */
  radialShare?: number
  /** Lloyd relaxation passes (each moves points halfway to their centroid). */
  relax?: number
  /** Extra margin around the visible area so parallax never shows an edge. */
  margin?: number
}

/** Small, fast, deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function polygonCentroid(poly: Point[]): Point {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!
    const [x1, y1] = poly[(i + 1) % poly.length]!
    const cross = x0 * y1 - x1 * y0
    a += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  a *= 0.5
  return [cx / (6 * a), cy / (6 * a)]
}

export function makeShards(opts: ShardOptions): Shard[] {
  const { width: w, height: h, count, seed } = opts
  const impact: Point = opts.impact ?? [w / 2, h * 0.56]
  const radialShare = opts.radialShare ?? 0.7
  const relax = opts.relax ?? 1
  const m = opts.margin ?? 0.08
  const rand = mulberry32(seed)
  const bounds: [number, number, number, number] = [-m * w, -m * h, w * (1 + m), h * (1 + m)]
  const maxR = Math.hypot(w, h) * 0.62

  const pts = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    let x: number
    let y: number
    if (rand() < radialShare) {
      const angle = rand() * Math.PI * 2
      const r = Math.pow(rand(), 1.6) * maxR + 8
      x = impact[0] + Math.cos(angle) * r
      y = impact[1] + Math.sin(angle) * r
    } else {
      x = bounds[0] + rand() * (bounds[2] - bounds[0])
      y = bounds[1] + rand() * (bounds[3] - bounds[1])
    }
    pts[i * 2] = Math.min(bounds[2] - 1, Math.max(bounds[0] + 1, x))
    pts[i * 2 + 1] = Math.min(bounds[3] - 1, Math.max(bounds[1] + 1, y))
  }

  const delaunay = new Delaunay(pts)
  const voronoi = delaunay.voronoi(bounds)
  for (let pass = 0; pass < relax; pass++) {
    for (let i = 0; i < count; i++) {
      const cell = voronoi.cellPolygon(i)
      if (!cell) continue
      const [cx, cy] = polygonCentroid(cell.slice(0, -1) as Point[])
      pts[i * 2] = (pts[i * 2]! + cx) / 2
      pts[i * 2 + 1] = (pts[i * 2 + 1]! + cy) / 2
    }
    delaunay.update()
    voronoi.update()
  }

  const shards: Shard[] = []
  let maxDist = 1
  for (let i = 0; i < count; i++) {
    const cell = voronoi.cellPolygon(i)
    if (!cell || cell.length < 4) continue
    const polygon = cell.slice(0, -1).map(([x, y]) => [x, y] as Point)
    const centroid = polygonCentroid(polygon)
    const xs = polygon.map((p) => p[0])
    const ys = polygon.map((p) => p[1])
    const d = Math.hypot(centroid[0] - impact[0], centroid[1] - impact[1])
    maxDist = Math.max(maxDist, d)
    shards.push({
      index: i,
      polygon,
      centroid,
      bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      neighbors: [...voronoi.neighbors(i)],
      distance: d,
    })
  }
  for (const s of shards) s.distance /= maxDist
  return shards
}

/** Move every vertex towards the centroid by `px`, so dark gaps read as cracks. */
export function insetPolygon(poly: Point[], centroid: Point, px: number): Point[] {
  return poly.map(([x, y]) => {
    const dx = centroid[0] - x
    const dy = centroid[1] - y
    const len = Math.hypot(dx, dy) || 1
    const k = Math.min(px, len * 0.45) / len
    return [x + dx * k, y + dy * k] as Point
  })
}

/**
 * Give each shard a tile (clip) index so that neighbouring shards never show
 * the same clip when that is possible (greedy colouring, deterministic).
 */
export function assignTiles(shards: Shard[], tileCount: number, seed = 1): Map<number, number> {
  const rand = mulberry32(seed)
  const out = new Map<number, number>()
  const order = [...shards].sort((a, b) => a.distance - b.distance)
  for (const s of order) {
    const taken = new Set(s.neighbors.map((n) => out.get(n)).filter((t): t is number => t !== undefined))
    const start = Math.floor(rand() * tileCount)
    let tile = start
    for (let k = 0; k < tileCount; k++) {
      const candidate = (start + k) % tileCount
      if (!taken.has(candidate)) {
        tile = candidate
        break
      }
    }
    out.set(s.index, tile)
  }
  return out
}

/**
 * UVs that make a tile cover a shard like CSS object-fit: cover. The tile with
 * aspect `aspect` (w/h) sits at [u0,v0]..[u0+du, v0+dv] in the atlas; `inset`
 * (in UV units) keeps samples away from the neighbouring tiles' edges. A
 * non-square atlas needs a different inset along v (`insetV`, defaults to
 * `inset`): 4 px is 4/1920 of the 1920x960 atlas across but 4/960 down.
 */
export function coverUv(
  p: Point,
  shard: Pick<Shard, 'bbox' | 'centroid'>,
  tile: { u0: number; v0: number; du: number; dv: number; aspect: number; inset?: number; insetV?: number },
): [number, number] {
  const bw = shard.bbox.x1 - shard.bbox.x0
  const bh = shard.bbox.y1 - shard.bbox.y0
  const cx = (shard.bbox.x0 + shard.bbox.x1) / 2
  const cy = (shard.bbox.y0 + shard.bbox.y1) / 2
  const tileW = Math.max(bw, bh * tile.aspect)
  const tileH = tileW / tile.aspect
  const insetU = tile.inset ?? 0
  const insetV = tile.insetV ?? insetU
  const fx = 0.5 + (p[0] - cx) / tileW
  const fy = 0.5 + (p[1] - cy) / tileH
  const u = tile.u0 + insetU + (tile.du - 2 * insetU) * Math.min(1, Math.max(0, fx))
  // Atlas v grows upwards (WebGL); scene y grows downwards.
  const v = tile.v0 + insetV + (tile.dv - 2 * insetV) * (1 - Math.min(1, Math.max(0, fy)))
  return [u, v]
}
