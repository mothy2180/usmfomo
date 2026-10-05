// tilemap.json (written by scripts/build-landing-atlas.py) describes the media
// atlases: grids of square tiles numbered row-major from the top-left.
import type { DeviceClass } from './layout.ts'

export type Grid = {
  width: number
  height: number
  cols: number
  rows: number
  /** Tile edge in pixels. */
  tile: number
  /** Samples stay this many pixels inside a tile (no bleeding from neighbours). */
  insetPx: number
}

export type VideoAtlas = Grid & {
  file: string
  /** Still of the first frame: shown until the video plays, or instead of it. */
  frame0: string
  /** RFC 6381 codec string, as asked of navigator.mediaCapabilities. */
  codec: string
  maxBitrate: number
  bytes: number
  frame0Bytes: number
}

export type StillsAtlas = Grid & { file: string; bytes: number }

export type Tilemap = {
  version: number
  fps: number
  seconds: number
  video: Record<DeviceClass, VideoAtlas>
  stills: Record<DeviceClass, StillsAtlas>
}

const CLASSES: readonly DeviceClass[] = ['desktop', 'mobile']

function checkGrid(name: string, g: Grid): void {
  const ok =
    [g.width, g.height, g.cols, g.rows, g.tile].every((n) => Number.isInteger(n) && n > 0) &&
    g.width === g.cols * g.tile &&
    g.height === g.rows * g.tile &&
    g.insetPx >= 0 &&
    g.insetPx * 2 < g.tile
  if (!ok) throw new Error(`tilemap: bad grid for ${name}`)
}

/** Sanity checks on the generated file; throws if it does not describe usable atlases. */
export function checkTilemap(tm: Tilemap): Tilemap {
  if (tm.version !== 1) throw new Error(`tilemap: unsupported version ${tm.version}`)
  if (!(tm.fps > 0 && tm.seconds > 0)) throw new Error('tilemap: bad timing')
  for (const c of CLASSES) {
    const v = tm.video[c]
    const s = tm.stills[c]
    checkGrid(`video.${c}`, v)
    checkGrid(`stills.${c}`, s)
    if (!v.file || !v.frame0 || !s.file) throw new Error(`tilemap: missing file names for ${c}`)
    if (!/^avc1\.[0-9A-F]{6}$/i.test(v.codec)) throw new Error(`tilemap: bad codec ${v.codec}`)
  }
  return tm
}

export function tileCount(g: Pick<Grid, 'cols' | 'rows'>): number {
  return g.cols * g.rows
}

/** Where tile `index` sits in the atlas, in UV units, for coverUvs(). */
export type TileRect = { u0: number; v0: number; du: number; dv: number; aspect: number; inset: number; insetV: number }

export function tileRect(g: Grid, index: number): TileRect {
  const n = tileCount(g)
  const i = ((Math.floor(index) % n) + n) % n
  const col = i % g.cols
  const row = Math.floor(i / g.cols)
  return {
    u0: col / g.cols,
    // Textures are uploaded with flipY, so v = 1 is the top row of the image.
    v0: 1 - (row + 1) / g.rows,
    du: 1 / g.cols,
    dv: 1 / g.rows,
    aspect: g.width / g.cols / (g.height / g.rows),
    inset: g.insetPx / g.width,
    insetV: g.insetPx / g.height,
  }
}

/**
 * UVs that make one tile cover a polygon like CSS object-fit: cover: the tile
 * is centred on the polygon's bounding box and scaled to cover it, and samples
 * stay the tile's inset away from its neighbours (a non-square atlas needs a
 * different inset along v: 4 px is 4/1920 across a 1920x960 atlas but 4/960
 * down). The polygon is y-up, like the atlas's v. `points` is the geometry's
 * position buffer (x, y, z per vertex).
 */
export function coverUvs(polygon: ReadonlyArray<readonly [number, number]>, rect: TileRect, points: ArrayLike<number>, count: number): Float32Array {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const tileW = Math.max(x1 - x0, (y1 - y0) * rect.aspect, 1e-6)
  const tileH = tileW / rect.aspect
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const uv = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const fx = clamp(0.5 + (points[i * 3]! - cx) / tileW)
    const fy = clamp(0.5 + (points[i * 3 + 1]! - cy) / tileH)
    uv[i * 2] = rect.u0 + rect.inset + (rect.du - 2 * rect.inset) * fx
    uv[i * 2 + 1] = rect.v0 + rect.insetV + (rect.dv - 2 * rect.insetV) * fy
  }
  return uv
}
