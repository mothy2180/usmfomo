// Poster pipeline (Module 3): the browser re-encodes every upload, so the
// bucket only ever receives small WebP/JPEG files without EXIF/GPS metadata
// (drawing to a canvas and encoding again drops all metadata).
//
//   original (<= 10 MB, JPG/PNG/WebP)
//     -> decode (EXIF orientation applied)
//     -> poster: long edge <= 1600 px, WebP q0.82 stepping down to q0.42
//        until <= 350 KB; never more than 1.5 MiB
//     -> thumbnail: 360 px wide (height capped at 540 px), <= 40 KB target
//   Safari cannot encode WebP from a canvas (it returns PNG): both files are
//   then JPEG instead.
import { POSTER } from '@usmfomo/shared/config'

export type PosterErrorKey = 'file_too_big' | 'file_type' | 'image_decode' | 'image_too_big_after'

/** Thrown by the pipeline; `key` is an i18n key under "errors:". */
export class PosterError extends Error {
  readonly key: PosterErrorKey
  constructor(key: PosterErrorKey) {
    super(key)
    this.name = 'PosterError'
    this.key = key
  }
}

export type PosterFormat = { type: 'image/webp'; ext: 'webp' } | { type: 'image/jpeg'; ext: 'jpg' }
export const WEBP: PosterFormat = { type: 'image/webp', ext: 'webp' }
export const JPEG: PosterFormat = { type: 'image/jpeg', ext: 'jpg' }

export type Size = { width: number; height: number }

export type ProcessedPoster = {
  poster: Blob
  thumb: Blob
  format: PosterFormat
  size: Size
  thumbSize: Size
}

/** Quality ladders. The poster steps from 0.82 down to 0.42. */
export const POSTER_QUALITY = { start: 0.82, min: 0.42, step: 0.08 } as const
export const THUMB_QUALITY = { start: 0.72, min: 0.42, step: 0.1 } as const
/** Very tall posters would make very tall list thumbnails. */
export const THUMB_MAX_HEIGHT = 540

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** First gate, before any decoding. Type first: a 30 MB PDF needs the
 * "export as JPG/PNG" hint more than the size hint. */
export function validateFile(file: { size: number; type: string }): PosterErrorKey | null {
  if (!POSTER.inputTypes.includes(file.type)) return 'file_type'
  if (file.size > POSTER.maxInputBytes) return 'file_too_big'
  if (file.size === 0) return 'image_decode'
  return null
}

const clampSize = (width: number, height: number, scale: number): Size => ({
  width: Math.max(1, Math.round(width * scale)),
  height: Math.max(1, Math.round(height * scale)),
})

/** Scale so the long edge is at most `maxEdge` (never upscales). */
export function fitWithin(width: number, height: number, maxEdge: number = POSTER.maxEdge): Size {
  const long = Math.max(width, height)
  return clampSize(width, height, long > maxEdge ? maxEdge / long : 1)
}

/** Thumbnail: `targetWidth` wide keeping the aspect ratio, but never taller
 * than `maxHeight` and never upscaled. */
export function thumbSize(
  width: number,
  height: number,
  targetWidth: number = POSTER.thumbWidth,
  maxHeight: number = THUMB_MAX_HEIGHT,
): Size {
  let scale = Math.min(1, targetWidth / width)
  if (height * scale > maxHeight) scale = maxHeight / height
  return clampSize(width, height, scale)
}

/** [start, start - step, ...] down to and including `min` (2-decimal values). */
export function qualitySteps(start: number, min: number, step: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 100; i++) {
    const q = Math.round((start - i * step) * 100) / 100
    if (q < min - 1e-9) break
    out.push(q)
  }
  return out
}

/** Which format to keep after asking the canvas for WebP: anything that is
 * not WebP (Safari answers with PNG) means "use JPEG". */
export function formatForEncodedType(type: string): PosterFormat {
  return type === WEBP.type ? WEBP : JPEG
}

/**
 * Encode at each quality in turn and return the first result <= `target`.
 * If none is that small, the smallest result is used when it is <= `hardMax`;
 * otherwise the image is rejected ('image_too_big_after').
 */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<Blob>,
  steps: readonly number[],
  target: number,
  hardMax: number,
): Promise<{ blob: Blob; quality: number }> {
  let best: { blob: Blob; quality: number } | null = null
  for (const quality of steps) {
    const blob = await encode(quality)
    if (blob.size <= target) return { blob, quality }
    if (!best || blob.size < best.blob.size) best = { blob, quality }
  }
  if (best && best.blob.size <= hardMax) return best
  throw new PosterError('image_too_big_after')
}

/** "312 KB" / "1.2 MB" for the picker's status line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Browser plumbing (canvas, decoding). Not reachable from jsdom tests.
// ---------------------------------------------------------------------------

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void }

function makeCanvas(size: Size): { canvas: AnyCanvas; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(size.width, size.height)
      const ctx = canvas.getContext('2d')
      if (ctx) return { canvas, ctx }
    } catch {
      // older Safari: OffscreenCanvas without a 2D context — use a DOM canvas
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PosterError('image_decode')
  return { canvas, ctx }
}

function draw(source: CanvasImageSource, size: Size, background: string | null): AnyCanvas {
  const { canvas, ctx } = makeCanvas(size)
  if (background) {
    // JPEG has no alpha: paint transparent PNG areas white instead of black.
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size.width, size.height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, size.width, size.height)
  return canvas
}

function release(canvas: AnyCanvas): void {
  // Frees the backing store early (matters on iOS, which caps canvas memory).
  canvas.width = 0
  canvas.height = 0
}

function canvasToBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PosterError('image_decode'))), type, quality)
  })
}

async function encodeAs(canvas: AnyCanvas, format: PosterFormat, quality: number): Promise<Blob> {
  const blob = await canvasToBlob(canvas, format.type, quality)
  // The bucket only accepts what we declare as Content-Type; never upload a
  // blob whose real type differs from the format we chose.
  if (blob.type !== format.type) throw new PosterError('image_decode')
  return blob
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // unsupported option or format in this browser: try an <img> instead
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    // <img> applies EXIF orientation by default (image-orientation: from-image).
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new PosterError('image_decode')
  }
}

async function encodePoster(img: Decoded, size: Size): Promise<{ blob: Blob; format: PosterFormat }> {
  const steps = qualitySteps(POSTER_QUALITY.start, POSTER_QUALITY.min, POSTER_QUALITY.step)
  const first = steps[0] ?? POSTER_QUALITY.start
  let canvas = draw(img.source, size, null)
  try {
    // Ask for WebP once; the type of the answer decides the format for both
    // files (Safari answers with PNG, meaning "no WebP encoder": use JPEG).
    const probe = await canvasToBlob(canvas, WEBP.type, first)
    const format = formatForEncodedType(probe.type)
    if (format.type !== WEBP.type) {
      release(canvas)
      canvas = draw(img.source, size, '#ffffff')
    }
    const target = canvas
    const encode = (q: number) => (format.type === WEBP.type && q === first ? Promise.resolve(probe) : encodeAs(target, format, q))
    const { blob } = await encodeWithinBudget(encode, steps, POSTER.targetBytes, POSTER.maxBytes)
    return { blob, format }
  } finally {
    release(canvas)
  }
}

async function encodeThumb(img: Decoded, size: Size, format: PosterFormat): Promise<{ blob: Blob; size: Size }> {
  const steps = qualitySteps(THUMB_QUALITY.start, THUMB_QUALITY.min, THUMB_QUALITY.step)
  const background = format.type === JPEG.type ? '#ffffff' : null
  let best: { blob: Blob; size: Size } | null = null
  // Full thumbnail size first; if even the lowest quality is over budget
  // (very noisy images), try once more at 75 %. Never fails: a thumbnail a
  // little over 40 KB is harmless (the bucket allows 2 MiB).
  for (const scale of [1, 0.75]) {
    const s = clampSize(size.width, size.height, scale)
    const canvas = draw(img.source, s, background)
    try {
      const { blob } = await encodeWithinBudget((q) => encodeAs(canvas, format, q), steps, POSTER.thumbMaxBytes, Number.POSITIVE_INFINITY)
      if (!best || blob.size < best.blob.size) best = { blob, size: s }
      if (blob.size <= POSTER.thumbMaxBytes) break
    } finally {
      release(canvas)
    }
  }
  if (!best || best.blob.size > POSTER.maxBytes) throw new PosterError('image_too_big_after')
  return best
}

/** Validate, decode and re-encode a chosen file into a poster + thumbnail. */
export async function processPoster(file: File): Promise<ProcessedPoster> {
  const invalid = validateFile(file)
  if (invalid) throw new PosterError(invalid)
  const img = await decode(file)
  try {
    if (!img.width || !img.height) throw new PosterError('image_decode')
    const size = fitWithin(img.width, img.height, POSTER.maxEdge)
    const poster = await encodePoster(img, size)
    const thumb = await encodeThumb(img, thumbSize(img.width, img.height), poster.format)
    return { poster: poster.blob, thumb: thumb.blob, format: poster.format, size, thumbSize: thumb.size }
  } catch (err) {
    if (err instanceof PosterError) throw err
    throw new PosterError('image_decode')
  } finally {
    img.release()
  }
}
