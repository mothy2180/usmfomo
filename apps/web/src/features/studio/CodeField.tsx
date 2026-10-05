import { useTranslation } from 'react-i18next'
import { Field, Input } from '../../components/ui.tsx'
import { cleanCode } from './factors.ts'

type Props = {
  value: string
  /** i18n key (with namespace) of the current error. */
  error: string | null
  disabled?: boolean
  onChange: (code: string) => void
}

/** Selector a parent uses to focus this field inside its own container. */
export const CODE_INPUT_SELECTOR = 'input[name="code"]'

/**
 * The 6-digit authenticator code. Numeric keypad on phones, one-time-code
 * autofill, and pasted "123 456" or "123-456" is accepted (non-digits are
 * dropped). There is deliberately no maxLength: it would cut a pasted
 * "123 456" before the space is removed.
 */
export function CodeField({ value, error, disabled, onChange }: Props) {
  const { t } = useTranslation('studio')
  return (
    <Field label={t('mfa.code')} hint={t('mfa.codeHint')} error={error ? t(error) : null}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(cleanCode(e.currentTarget.value))}
          className="max-w-48 font-mono text-lg tracking-[0.3em]"
        />
      )}
    </Field>
  )
}
