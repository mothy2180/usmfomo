import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui.tsx'
import { shareOrCopy } from './share.ts'

const COPIED_MS = 3000

/** Share sheet where available, else copy the link ("Copied" for a few
 * seconds). If even copying fails, the link is shown to copy by hand. */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation('dashboard')
  const manualId = useId()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state !== 'copied') return
    const timer = window.setTimeout(() => setState('idle'), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [state])

  const onClick = async () => {
    const result = await shareOrCopy({ title, url })
    if (result === 'copied') setState('copied')
    else if (result === 'failed') setState('failed')
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void onClick()}>
        {state === 'copied' ? <span aria-hidden="true">✓</span> : null}
        {state === 'copied' ? t('common:actions.copied') : t('common:actions.share')}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? t('share.copied') : ''}
      </span>
      {state === 'failed' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={manualId} className="text-sm">
            {t('share.manual')}
          </label>
          <input
            id={manualId}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full min-h-11 rounded-lg border border-line bg-ink px-3 py-2 text-sm text-text"
          />
        </div>
      ) : null}
    </div>
  )
}
