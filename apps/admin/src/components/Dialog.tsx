import { useEffect, useId, useRef, type ReactNode } from 'react'

type DialogProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** When the content changes inside an open dialog (a new step), move focus to the title. */
  focusKey?: string
  /** The dialog can't be dismissed: Escape is ignored and a close forced by
   * the browser is undone (while busy, or while a show-once password is shown). */
  preventEscape?: boolean
  /** Extra description id for aria-describedby. */
  describedBy?: string
}

function show(el: HTMLDialogElement): void {
  if (typeof el.showModal === 'function') el.showModal()
  else el.setAttribute('open', '') // very old browsers / jsdom: non-modal fallback
}

/**
 * Accessible modal: a native <dialog> opened with showModal(), so the browser
 * makes the rest of the page inert, traps focus and handles Escape. Focus goes
 * to the element marked data-autofocus, else the first focusable element, and
 * returns to the opener on close. Content is only rendered while open, so
 * forms start fresh every time.
 */
export function Dialog({ open, title, onClose, children, focusKey, preventEscape, describedBy }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  const openRef = useRef(open)
  const lockedRef = useRef(Boolean(preventEscape))

  useEffect(() => {
    onCloseRef.current = onClose
    openRef.current = open
    lockedRef.current = Boolean(preventEscape)
  })

  useEffect(() => {
    const el = ref.current
    if (!el || !open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!el.open) show(el)
    // showModal() focuses the first focusable element; a [data-autofocus]
    // element wins (React does not render the autofocus attribute itself).
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      if (el.open) {
        if (typeof el.close === 'function') el.close()
        else el.removeAttribute('open')
      }
      // Removing a dialog from the DOM does not restore focus by itself.
      const target = opener?.isConnected ? opener : document.getElementById('main')
      target?.focus()
    }
  }, [open])

  const firstKey = useRef(focusKey)
  useEffect(() => {
    if (!open || focusKey === firstKey.current) return
    firstKey.current = focusKey
    titleRef.current?.focus()
  }, [focusKey, open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      className="modal"
      onCancel={(e) => {
        // Escape: React state stays the source of truth.
        e.preventDefault()
        if (!lockedRef.current) onCloseRef.current()
      }}
      onClose={(e) => {
        // Closed by the browser itself: Chrome lets a repeated Escape through
        // even when "cancel" is prevented.
        if (!openRef.current) return
        if (lockedRef.current) show(e.currentTarget)
        else onCloseRef.current()
      }}
    >
      {open ? (
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="m-0 text-lg font-bold">
            {title}
          </h2>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
