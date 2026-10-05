// Small UI primitives, adapted from apps/web/src/components/ui.tsx (English
// only, no router). Tailwind classes only — no inline style attributes (the
// CSP has no 'unsafe-inline' for styles).
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import { useId } from 'react'
import { cx } from '../lib/cx.ts'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-105 font-semibold',
  secondary: 'bg-surface-2 text-text border border-line hover:border-sky',
  danger: 'bg-transparent text-danger border border-danger/60 hover:bg-danger/10',
  ghost: 'bg-transparent text-text hover:bg-surface-2',
}

export function Button({
  variant = 'secondary',
  className,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
    >
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  )
}

export function Card({
  className,
  children,
  as: Tag = 'div',
  labelledBy,
}: {
  className?: string
  children: ReactNode
  as?: 'div' | 'section' | 'article' | 'li'
  labelledBy?: string
}) {
  return (
    <Tag aria-labelledby={labelledBy} className={cx('rounded-xl border border-line bg-surface p-4', className)}>
      {children}
    </Tag>
  )
}

export type Tone = 'neutral' | 'accent' | 'sky' | 'danger' | 'ok'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-surface-2 text-muted',
    accent: 'bg-accent text-accent-ink',
    sky: 'bg-sky/15 text-sky',
    danger: 'bg-danger/15 text-danger',
    ok: 'bg-ok/15 text-ok',
  }
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  )
}

export function Spinner({ small, label = 'Loading…' }: { small?: boolean; label?: string }) {
  // <output> has the implicit role "status" (a polite live region).
  return (
    <output className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden="true"
        className={cx(
          'inline-block rounded-full border-2 border-line border-t-sky motion-safe:animate-spin',
          small ? 'h-4 w-4' : 'h-6 w-6',
        )}
      />
      {small ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </output>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4">
      <p className="m-0 text-sm">{message}</p>
      {onRetry ? (
        <Button onClick={onRetry} variant="secondary">
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/** Inline error under a form or inside a dialog. */
export function FormError({ message }: { message: string | null | undefined }) {
  return (
    <p role="alert" className={cx('m-0 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger', !message && 'hidden')}>
      {message}
    </p>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-6 text-center">
      <p className="m-0 font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  )
}

/** A highlighted note: tone "warn" for things the owner must not miss. */
export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger'; title?: string; children: ReactNode }) {
  const tones = {
    info: 'border-sky/40 bg-sky/5',
    warn: 'border-accent/70 bg-accent/10',
    danger: 'border-danger/60 bg-danger/10',
  }
  return (
    <div className={cx('rounded-lg border p-3 text-sm', tones[tone])}>
      {title ? <p className="m-0 font-semibold">{title}</p> : null}
      <div className={cx('flex flex-col gap-2', title && 'mt-1')}>{children}</div>
    </div>
  )
}

type FieldProps = {
  label: string
  hint?: ReactNode
  error?: string | null
  /** Optional id so a form can focus its first invalid field. */
  id?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}

/** Labelled form field; hint and error are linked with aria-describedby. */
export function Field({ label, hint, error, id: givenId, children }: FieldProps) {
  const autoId = useId()
  const id = givenId ?? autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="m-0 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      <p id={errId} className={cx('m-0 text-xs text-danger', !error && 'hidden')}>
        {error}
      </p>
    </div>
  )
}

const inputBase =
  'w-full min-h-11 rounded-lg border border-line bg-ink px-3 py-2 text-sm text-text placeholder:text-muted/70 aria-[invalid=true]:border-danger'

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputBase, props.className)} />
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(inputBase, 'min-h-28', props.className)} />
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} className={cx(inputBase, props.className)} />
}

/** A labelled checkbox with a 24 px+ target. */
export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 h-6 w-6 shrink-0 accent-accent"
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="m-0 text-xs text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}

type RadioOption<T extends string> = { value: T; label: string; hint?: string }

/** Radio buttons in a fieldset. `id` lands on the first radio, so a form can
 * focus the group when it is invalid. Hints are part of each option's label. */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  error,
  id: givenId,
  disabled,
}: {
  legend: string
  name: string
  value: T | ''
  options: ReadonlyArray<RadioOption<T>>
  onChange: (value: T) => void
  error?: string | null
  id?: string
  disabled?: boolean
}) {
  const autoId = useId()
  const base = givenId ?? autoId
  const errId = `${base}-err`
  return (
    <fieldset
      role="radiogroup"
      aria-invalid={error ? true : undefined}
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <legend className="mb-1 p-0 text-sm font-semibold">{legend}</legend>
      {options.map((o, i) => {
        const optionId = i === 0 ? base : `${base}-${o.value}`
        return (
          <label
            key={o.value}
            htmlFor={optionId}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 has-checked:border-sky has-checked:bg-surface-2"
          >
            <input
              id={optionId}
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              disabled={disabled}
              aria-describedby={error ? errId : undefined}
              className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold">{o.label}</span>
              {o.hint ? <span className="text-xs text-muted">{o.hint}</span> : null}
            </span>
          </label>
        )
      })}
      <p id={errId} className={cx('m-0 text-xs text-danger', !error && 'hidden')}>
        {error}
      </p>
    </fieldset>
  )
}
