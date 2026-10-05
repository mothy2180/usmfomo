import { useEffect, useRef, type ReactNode } from 'react'

/** Page title that takes focus when it appears, so screen-reader and keyboard
 * users land at the top of each new screen (sign-in steps, console sections). */
export function PageHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: false })
  }, [])
  return (
    <h1 ref={ref} tabIndex={-1} className="m-0 text-2xl font-bold tracking-tight">
      {children}
    </h1>
  )
}
