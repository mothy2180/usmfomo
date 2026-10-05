import { useCallback, type ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & { blob: Blob; alt: string }

/**
 * <img> for an in-memory Blob (the re-encoded poster before upload). The
 * blob: URL (CSP img-src blob:) is created when the image mounts and revoked
 * when the Blob changes or the image unmounts (a React 19 ref cleanup).
 */
export function BlobImage({ blob, alt, ...rest }: Props) {
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return
      const url = URL.createObjectURL(blob)
      img.src = url
      return () => URL.revokeObjectURL(url)
    },
    [blob],
  )
  return <img ref={ref} alt={alt} {...rest} />
}
