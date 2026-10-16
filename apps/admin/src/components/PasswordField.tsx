import { useState } from 'react'
import { PASSWORD_RULES, passwordChecks, suggestPassword } from '@usmfomo/shared/password'
import { cx } from '../lib/cx.ts'
import { Button, Field, Input } from './ui.tsx'

type Props = {
  /** Lets a form focus the field when it is invalid. */
  id?: string
  label?: string
  value: string
  onChange: (password: string) => void
  error?: string | null
  disabled?: boolean
}

/**
 * A new password the owner types, or leaves empty for a random one from the
 * server. "Suggest" fills in a random password made in this browser (same
 * alphabet and length as the server's), which the owner can still edit. The
 * checklist uses the shared rules (@usmfomo/shared/password), which owner-admin
 * checks again.
 */
export function PasswordField({ id, label = 'New password', value, onChange, error, disabled }: Props) {
  const [visible, setVisible] = useState(false)
  const checks = passwordChecks(value)
  return (
    <Field
      id={id}
      label={label}
      hint="Leave it empty for a random 24-character password, or type or suggest one. It is shown once afterwards."
      error={error}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <Input
              id={inputId}
              type={visible ? 'text' : 'password'}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.currentTarget.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={[describedBy, value ? `${inputId}-rules` : undefined].filter(Boolean).join(' ') || undefined}
              className="min-w-0 flex-1 basis-56 font-mono"
            />
            <Button onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-controls={inputId} disabled={disabled}>
              {visible ? 'Hide' : 'Show'}
            </Button>
          </div>
          <Button
            onClick={() => {
              onChange(suggestPassword())
              setVisible(true)
            }}
            disabled={disabled}
            className="self-start"
          >
            Suggest a strong password
          </Button>
          {value ? (
            <ul id={`${inputId}-rules`} aria-label="Password rules" className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
              {PASSWORD_RULES.map(({ rule, label: text }) => (
                <li key={rule} className={cx(checks[rule] ? 'text-ok' : 'text-danger')}>
                  <span aria-hidden="true">{checks[rule] ? '✓' : '✗'} </span>
                  {text}
                  <span className="sr-only">{checks[rule] ? ' (met)' : ' (not met)'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  )
}
