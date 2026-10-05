import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Dialog } from './Dialog.tsx'
import { Button, Field, FormError, Input } from './ui.tsx'

type ConfirmDialogProps = {
  open: boolean
  title: string
  /** What will happen — every confirm explains its effect. */
  children: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  error?: string | null
  /** Require typing this exact text (e.g. the username) before confirming. */
  confirmText?: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  busy,
  error,
  confirmText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const descId = useId()
  return (
    <Dialog open={open} title={title} onClose={onClose} preventEscape={busy} describedBy={descId}>
      <ConfirmBody
        descId={descId}
        confirmLabel={confirmLabel}
        tone={tone}
        busy={busy}
        error={error}
        confirmText={confirmText}
        onConfirm={onConfirm}
        onCancel={onClose}
      >
        {children}
      </ConfirmBody>
    </Dialog>
  )
}

/** The inside of a confirm step; also used for steps within larger dialogs. */
export function ConfirmBody({
  descId,
  children,
  confirmLabel,
  tone = 'danger',
  busy,
  error,
  confirmText,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  descId?: string
  children: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  error?: string | null
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
  cancelLabel?: string
}) {
  const [typed, setTyped] = useState('')
  const matches = confirmText === undefined || typed.trim() === confirmText
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (matches && !busy) onConfirm()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div id={descId} className="flex flex-col gap-2 text-sm">
        {children}
      </div>
      {confirmText !== undefined ? (
        <Field
          label={`Type ${confirmText} to confirm`}
          hint="This can't be undone."
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </Field>
      ) : null}
      <FormError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} busy={busy} disabled={!matches}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  )
}
