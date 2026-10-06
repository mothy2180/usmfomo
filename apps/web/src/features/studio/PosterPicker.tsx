import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button, Field } from '../../components/ui.tsx'
import { formatBytes, type ProcessedPoster } from '../../lib/poster.ts'
import { BlobImage } from './BlobImage.tsx'

export type PosterSelection =
  | { kind: 'none' }
  | { kind: 'existing' }
  | { kind: 'removed' }
  | { kind: 'new'; processed: ProcessedPoster }

type Props = {
  selection: PosterSelection
  busy: boolean
  /** i18n key (with namespace) of the last failure. */
  error: string | null
  /** Public URL of the current poster (edit). */
  existingUrl?: string
  /** Posting is paused: no uploads. */
  disabled?: boolean
  onPick: (file: File) => void
  onRemove: () => void
  onUndoRemove: () => void
}

const ACCEPT = 'image/jpeg,image/png,image/webp'
const PREVIEW_CLASS = 'max-h-80 w-auto max-w-full self-start rounded-lg border border-line bg-ink object-contain'
const FILE_INPUT = 'input[type="file"]'

export function PosterPicker({ selection, busy, error, existingUrl, disabled, onPick, onRemove, onUndoRemove }: Props) {
  const { t } = useTranslation('studio')
  const rootRef = useRef<HTMLDivElement>(null)
  const hasPoster = selection.kind === 'new' || selection.kind === 'existing'

  // "Remove poster" and "Keep the current poster" each disappear with the
  // selection they change: focus the first of `targets` that replaced them,
  // instead of letting it fall to <body>.
  const changeThenFocus = (change: () => void, ...targets: string[]) => {
    flushSync(change)
    for (const selector of targets) {
      const el = rootRef.current?.querySelector<HTMLElement>(selector)
      if (el) return el.focus()
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <Field label={t('poster.label')} hint={t('poster.hint')} error={error ? t(error) : null}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="file"
            accept={ACCEPT}
            // While a poster is processed the input keeps focus (a real
            // `disabled` would drop it to <body>, and the result would go
            // unheard): it is marked aria-disabled and ignores picks.
            disabled={disabled}
            aria-disabled={busy || undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onClick={busy ? (e) => e.preventDefault() : undefined}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              // Clear it so choosing the same file again still fires onChange.
              e.currentTarget.value = ''
              if (file && !busy) onPick(file)
            }}
            className="block min-h-11 w-full text-sm text-muted file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-field-line file:bg-surface-2 file:px-4 file:py-2 file:text-sm file:text-text hover:file:border-sky disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:file:cursor-not-allowed"
          />
        )}
      </Field>

      {/* Always rendered: a live region must exist before its text changes. */}
      <p aria-live="polite" className="m-0 flex items-center gap-2 text-sm">
        {busy ? (
          <>
            <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-sky" />
            <span>{t('poster.processing')}</span>
          </>
        ) : null}
        {!busy && selection.kind === 'new'
          ? t('poster.ready', {
              size: formatBytes(selection.processed.poster.size),
              format: selection.processed.format.ext === 'webp' ? 'WebP' : 'JPEG',
            })
          : null}
        {!busy && selection.kind === 'removed' ? t('poster.removed') : null}
      </p>

      {selection.kind === 'new' ? (
        <BlobImage blob={selection.processed.poster} alt={t('poster.previewAlt')} className={PREVIEW_CLASS} />
      ) : null}
      {selection.kind === 'existing' && existingUrl ? (
        <figure className="m-0 flex flex-col gap-2">
          <img src={existingUrl} alt={t('poster.previewAlt')} className={PREVIEW_CLASS} />
          <figcaption className="text-xs text-muted">{t('poster.current')}</figcaption>
        </figure>
      ) : null}

      <div className="flex flex-wrap gap-2 empty:hidden">
        {hasPoster ? (
          <Button
            variant="danger"
            data-remove-poster
            onClick={() => changeThenFocus(onRemove, '[data-keep-poster]', FILE_INPUT)}
            disabled={disabled || busy}
          >
            {t('poster.remove')}
          </Button>
        ) : null}
        {selection.kind === 'removed' ? (
          <Button data-keep-poster onClick={() => changeThenFocus(onUndoRemove, '[data-remove-poster]')} disabled={disabled || busy}>
            {t('poster.undoRemove')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
