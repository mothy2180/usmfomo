import { displayHostname } from '@usmfomo/shared/links'
import type { ReactNode } from 'react'

/** Club-provided links (copied from apps/web): https only (enforced by the
 * database), opened in a new tab without referrer, always shown with their
 * real hostname. Anything that fails the check is not rendered as a link. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const host = displayHostname(href)
  if (!host) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="inline-flex flex-wrap items-baseline gap-x-2 break-all text-sky underline"
    >
      <span>{children}</span>
      <span className="text-xs text-muted no-underline">({host})</span>
    </a>
  )
}
