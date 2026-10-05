import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from '../../components/ui.tsx'

type Props = {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  /** Shown inside the dialog (role=alert) when the action failed. */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal confirmation on the native <dialog>: focus is trapped and Escape
 * closes it (showModal), the title and body name and describe it, focus
 * starts on the safe choice and returns to the opener when it closes.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, busy, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<Element | null>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      openerRef.current = document.activeElement
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      const opener = openerRef.current
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        // Escape: close through React state so the effect restores focus.
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-5 text-text backdrop:bg-black/70"
    >
      <h2 id={titleId} className="m-0 text-lg font-bold">
        {title}
      </h2>
      <div id={bodyId} className="mt-2 text-sm text-muted">
        {body}
      </div>
      {error ? (
        <p role="alert" className="mt-3 mb-0 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button data-autofocus onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
