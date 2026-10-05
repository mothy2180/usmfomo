import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnnounceContext } from '../lib/announce.ts'

/**
 * A polite live region plus a visible toast. Messages are set shortly after
 * the call: most confirmations follow closing a modal <dialog>, and content
 * outside an open modal is inert, so an immediate update could go unread.
 */
export function Announcer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null)
  const nextId = useRef(0)

  const announce = useCallback((text: string) => {
    const id = ++nextId.current
    window.setTimeout(() => setMessage({ text, id }), 150)
  }, [])

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 7_000)
    return () => window.clearTimeout(t)
  }, [message])

  return (
    <AnnounceContext value={announce}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {/* <output> is a polite status region; it stays mounted so updates are announced. */}
        <output aria-live="polite" className="block max-w-lg">
          {message ? (
            <span key={message.id} className="block rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm shadow-lg">
              {message.text}
            </span>
          ) : null}
        </output>
      </div>
    </AnnounceContext>
  )
}
