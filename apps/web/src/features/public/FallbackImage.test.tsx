import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FallbackImage } from './FallbackImage.tsx'

// Same behaviour as lib/db.ts: proxy URL first, then one retry straight from
// Supabase (marked with data-fallback).
vi.mock('../../lib/db.ts', () => ({
  imageSrc: (path: string | null | undefined) => (path && !path.includes('..') ? `/i/${path}` : undefined),
  onImageError: (event: { currentTarget: HTMLImageElement }, path: string | null | undefined) => {
    const img = event.currentTarget
    if (!path || img.dataset.fallback === '1') return
    img.dataset.fallback = '1'
    img.src = `https://supabase.example/${path}`
  },
}))

const POSTER = 'org/poster.webp'
const THUMB = 'org/poster-thumb.webp'
const img = () => screen.getByRole('img') as HTMLImageElement

describe('FallbackImage', () => {
  afterEach(cleanup)

  it('tries the proxy, then Supabase, then the next path, then the fallback', () => {
    render(<FallbackImage paths={[POSTER, THUMB]} alt="Poster: Hack Night" width={800} height={1000} fallback={<p>cover</p>} />)
    expect(img().getAttribute('src')).toBe(`/i/${POSTER}`)
    expect(img().getAttribute('alt')).toBe('Poster: Hack Night')
    expect(img().getAttribute('loading')).toBe('lazy')
    expect(img().getAttribute('decoding')).toBe('async')

    fireEvent.error(img())
    expect(img().getAttribute('src')).toBe(`https://supabase.example/${POSTER}`)
    fireEvent.error(img())
    expect(img().getAttribute('src')).toBe(`/i/${THUMB}`)
    fireEvent.error(img())
    expect(img().getAttribute('src')).toBe(`https://supabase.example/${THUMB}`)
    fireEvent.error(img())
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('cover')).toBeTruthy()
  })

  it('skips missing or invalid paths and shows the fallback when none is left', () => {
    render(<FallbackImage paths={[null, '../etc/passwd', undefined]} alt="" width={96} height={96} fallback={<p>cover</p>} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('cover')).toBeTruthy()
  })

  it('passes eager loading and priority through for the event poster', () => {
    render(<FallbackImage paths={[POSTER]} alt="x" width={800} height={1000} loading="eager" fetchPriority="high" />)
    expect(img().getAttribute('loading')).toBe('eager')
    expect(img().getAttribute('fetchpriority')).toBe('high')
    expect(img().getAttribute('width')).toBe('800')
    expect(img().getAttribute('height')).toBe('1000')
  })
})
