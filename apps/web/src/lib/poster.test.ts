import { POSTER } from '@usmfomo/shared/config'
import { describe, expect, it } from 'vitest'
import {
  JPEG,
  POSTER_QUALITY,
  PosterError,
  THUMB_MAX_HEIGHT,
  THUMB_QUALITY,
  WEBP,
  encodeWithinBudget,
  fitWithin,
  formatBytes,
  formatForEncodedType,
  qualitySteps,
  thumbSize,
  validateFile,
} from './poster.ts'

const MB = 1024 * 1024
const fakeBlob = (size: number, type = 'image/webp') => ({ size, type }) as Blob

describe('validateFile', () => {
  it('accepts JPEG, PNG and WebP up to 10 MB', () => {
    expect(validateFile({ size: 2 * MB, type: 'image/jpeg' })).toBeNull()
    expect(validateFile({ size: 2 * MB, type: 'image/png' })).toBeNull()
    expect(validateFile({ size: POSTER.maxInputBytes, type: 'image/webp' })).toBeNull()
  })

  it('rejects files over 10 MB', () => {
    expect(validateFile({ size: POSTER.maxInputBytes + 1, type: 'image/jpeg' })).toBe('file_too_big')
  })

  it('sends HEIC, PDF, SVG, GIF and unknown types to the export hint', () => {
    for (const type of ['image/heic', 'image/heif', 'application/pdf', 'image/svg+xml', 'image/gif', '']) {
      expect(validateFile({ size: 1000, type })).toBe('file_type')
    }
  })

  it('reports the type before the size (a big PDF needs the export hint)', () => {
    expect(validateFile({ size: 50 * MB, type: 'application/pdf' })).toBe('file_type')
  })

  it('treats an empty file as unreadable', () => {
    expect(validateFile({ size: 0, type: 'image/png' })).toBe('image_decode')
  })
})

describe('scale maths', () => {
  it('caps the long edge at 1600 px and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(1080, 1920)).toEqual({ width: 900, height: 1600 })
    expect(fitWithin(3000, 3000)).toEqual({ width: 1600, height: 1600 })
  })

  it('never upscales small images', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 })
  })

  it('never returns a zero dimension for extreme panoramas', () => {
    expect(fitWithin(16000, 4)).toEqual({ width: 1600, height: 1 })
  })

  it('makes 360 px wide thumbnails', () => {
    expect(thumbSize(1600, 1200)).toEqual({ width: POSTER.thumbWidth, height: 270 })
    expect(thumbSize(1200, 1200)).toEqual({ width: 360, height: 360 })
  })

  it('caps tall thumbnails at 540 px high', () => {
    // A9 portrait poster (1:1.414) at 360 px wide would be 509 px: allowed.
    expect(thumbSize(1131, 1600)).toEqual({ width: 360, height: 509 })
    // Phone screenshot 9:16 would be 640 px high: scaled to 540 instead.
    expect(thumbSize(900, 1600)).toEqual({ width: 304, height: THUMB_MAX_HEIGHT })
  })

  it('does not upscale small thumbnails', () => {
    expect(thumbSize(200, 100)).toEqual({ width: 200, height: 100 })
  })
})

describe('quality steps', () => {
  it('poster quality steps from 0.82 down to 0.42', () => {
    expect(qualitySteps(POSTER_QUALITY.start, POSTER_QUALITY.min, POSTER_QUALITY.step)).toEqual([
      0.82, 0.74, 0.66, 0.58, 0.5, 0.42,
    ])
  })

  it('thumbnail quality steps from 0.72 down to 0.42', () => {
    expect(qualitySteps(THUMB_QUALITY.start, THUMB_QUALITY.min, THUMB_QUALITY.step)).toEqual([0.72, 0.62, 0.52, 0.42])
  })

  it('returns only the start when it is already the minimum', () => {
    expect(qualitySteps(0.5, 0.5, 0.1)).toEqual([0.5])
  })
})

describe('encodeWithinBudget', () => {
  const steps = [0.82, 0.74, 0.66]

  it('stops at the first quality under the target', async () => {
    const tried: number[] = []
    const sizes: Record<number, number> = { 0.82: 500_000, 0.74: 300_000, 0.66: 200_000 }
    const out = await encodeWithinBudget(
      async (q) => {
        tried.push(q)
        return fakeBlob(sizes[q]!)
      },
      steps,
      350 * 1024,
      1.5 * MB,
    )
    expect(out.quality).toBe(0.74)
    expect(tried).toEqual([0.82, 0.74])
  })

  it('falls back to the smallest result when the target is never met', async () => {
    const out = await encodeWithinBudget(async (q) => fakeBlob(Math.round(q * 1_000_000)), steps, 100_000, 1.5 * MB)
    expect(out.quality).toBe(0.66)
    expect(out.blob.size).toBe(660_000)
  })

  it('rejects images that stay over the hard cap', async () => {
    const run = encodeWithinBudget(async () => fakeBlob(2 * MB), steps, 350 * 1024, POSTER.maxBytes)
    await expect(run).rejects.toBeInstanceOf(PosterError)
    await expect(run).rejects.toMatchObject({ key: 'image_too_big_after' })
  })

  it('passes encoder errors through', async () => {
    const boom = new Error('toBlob returned null')
    await expect(encodeWithinBudget(async () => Promise.reject(boom), steps, 1, 2)).rejects.toBe(boom)
  })
})

describe('type decisions', () => {
  it('keeps WebP only when the canvas really produced WebP', () => {
    expect(formatForEncodedType('image/webp')).toBe(WEBP)
    // Safari returns PNG for an unsupported toBlob type.
    expect(formatForEncodedType('image/png')).toBe(JPEG)
    expect(formatForEncodedType('')).toBe(JPEG)
  })

  it('maps formats to the storage extensions the database accepts', () => {
    expect(WEBP.ext).toBe('webp')
    expect(JPEG.ext).toBe('jpg')
    expect(JPEG.type).toBe('image/jpeg')
  })

  it('formats sizes for the picker', () => {
    expect(formatBytes(312 * 1024)).toBe('312 KB')
    expect(formatBytes(300)).toBe('1 KB')
    expect(formatBytes(1.25 * MB)).toBe('1.3 MB')
  })
})
