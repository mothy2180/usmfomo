import { useState, type ReactNode, type SyntheticEvent } from 'react'
import { imageSrc, onImageError } from '../../lib/db.ts'

type Props = {
  /** Storage paths to try in order (e.g. poster, then thumbnail). */
  paths: ReadonlyArray<string | null | undefined>
  alt: string
  width: number
  height: number
  className?: string
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'high' | 'low' | 'auto'
  /** Shown when there is no usable path or every URL failed. */
  fallback?: ReactNode
}

/**
 * <img> for posters and thumbnails. Each path is tried through the image proxy
 * and then directly from Supabase (onImageError); after that the next path,
 * and finally the fallback.
 */
export function FallbackImage({ paths, alt, width, height, className, loading = 'lazy', fetchPriority, fallback = null }: Props) {
  const candidates = paths.filter((p): p is string => Boolean(p && imageSrc(p)))
  const key = candidates.join('|')
  const [failed, setFailed] = useState({ key, count: 0 })
  const stage = failed.key === key ? failed.count : 0
  const path = candidates[stage]
  if (!path) return <>{fallback}</>

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    if (img.dataset.fallback !== '1') {
      onImageError(event, path)
      if (img.dataset.fallback === '1') return // now retrying the direct URL
    }
    setFailed({ key, count: stage + 1 })
  }

  return (
    <img
      key={`${stage}:${path}`}
      src={imageSrc(path)}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      className={className}
      onError={handleError}
    />
  )
}
