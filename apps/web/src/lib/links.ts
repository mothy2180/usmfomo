import type { MouseEvent } from 'react'

/** Plain-link click that may be handled client-side (left button, no modifier keys). */
export function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented
}
