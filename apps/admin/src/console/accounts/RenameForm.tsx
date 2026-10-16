import { useId, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Button, Field, Input } from '../../components/ui.tsx'
import type { AccountRow } from '../../lib/api.ts'
import { validateRename } from './accountForms.ts'

type Props = {
  account: AccountRow
  accounts: readonly AccountRow[]
  onCancel: () => void
  /** A valid new username (normalised); the dialog asks for confirmation next. */
  onNext: (username: string) => void
  initial?: string
}

/** First step of "Change username": the new name, checked like at creation. */
export function RenameForm({ account, accounts, onCancel, onNext, initial = '' }: Props) {
  const id = useId()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | undefined>(undefined)

  function submit(e: FormEvent) {
    e.preventDefault()
    const result = validateRename(value, account, accounts)
    if (!result.ok) {
      // Commit the error first, so the field is already invalid (and
      // described by its error) when it receives focus.
      flushSync(() => setError(result.errors.username))
      document.getElementById(id)?.focus()
      return
    }
    onNext(result.data)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-sm">
        Current username: <span className="break-all font-mono">{account.username}</span>
      </p>
      <Field
        id={id}
        label="New username"
        hint="What they sign in with: 3–32 lowercase letters, digits or hyphens, starting and ending with a letter or digit."
        error={error}
      >
        {({ id: inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            value={value}
            maxLength={32}
            onChange={(e) => {
              setValue(e.currentTarget.value)
              setError(undefined)
            }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="font-mono"
          />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Back</Button>
        <Button type="submit" variant="primary">
          Continue
        </Button>
      </div>
    </form>
  )
}
