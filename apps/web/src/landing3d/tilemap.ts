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

/** Where tile `index` sits in the atlas, in UV units, for coverUv(). */
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
