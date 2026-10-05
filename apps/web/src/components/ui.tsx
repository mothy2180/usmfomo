// Small UI primitives shared by every page. Tailwind classes only — no inline
// style attributes (the CSP has no 'unsafe-inline' for styles).
import { Link, type LinkProps } from '@tanstack/react-router'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { errorKey } from '@usmfomo/shared/errors'

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

export function ButtonLink({ variant = 'secondary', className, ...rest }: LinkProps & { variant?: Variant; className?: string; children?: ReactNode }) {
  return (
    <Link
      {...rest}
      className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm no-underline transition', variants[variant], className)}
    />
  )
}

export function Card({ className, children, as: Tag = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <Tag className={cx('rounded-xl border border-line bg-surface p-4', className)}>{children}</Tag>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'sky' | 'danger' | 'ok'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    accent: 'bg-accent text-accent-ink',
    sky: 'bg-sky/15 text-sky',
    danger: 'bg-danger/15 text-danger',
    ok: 'bg-ok/15 text-ok',
  }
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>
}

export function Spinner({ small, label }: { small?: boolean; label?: string }) {
  const { t } = useTranslation()
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden="true"
        className={cx('inline-block animate-spin rounded-full border-2 border-line border-t-sky', small ? 'h-4 w-4' : 'h-6 w-6')}
      />
      {small ? <span className="sr-only">{label ?? t('actions.loading')}</span> : <span>{label ?? t('actions.loading')}</span>}
    </span>
  )
}

export function ErrorState({ error, onRetry, message }: { error?: unknown; onRetry?: () => void; message?: string }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4">
      <p className="m-0 text-sm">{message ?? (error ? t(`errors:${errorKey(error)}`) : t('error.title'))}</p>
      {onRetry ? (
        <Button onClick={onRetry} variant="secondary">
          {t('actions.retry')}
        </Button>
      ) : null}
    </div>
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

type FieldProps = { label: string; hint?: string; error?: string | null; children: (ids: { id: string; describedBy?: string }) => ReactNode }

/** Labelled form field; the error is linked with aria-describedby and announced. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({ id, describedBy })}
      {hint ? (
        <p id={hintId} className="m-0 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      <p id={errId} aria-live="polite" className={cx('m-0 text-xs text-danger', !error && 'hidden')}>
        {error}
      </p>
    </div>
  )
}

const inputBase =
  'w-full min-h-11 rounded-lg border border-line bg-ink px-3 py-2 text-sm text-text placeholder:text-muted/70 aria-[invalid=true]:border-danger'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputBase, 'min-h-28', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, props.className)} />
}
