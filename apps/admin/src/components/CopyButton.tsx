import { useEffect, useState } from 'react'
import { Button } from './ui.tsx'

/** Copies `text` with the async Clipboard API; on failure, asks the owner to
 * copy it by hand (the text next to the button is selectable). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state !== 'copied') return
    const t = window.setTimeout(() => setState('idle'), 3_000)
    return () => window.clearTimeout(t)
  }, [state])

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={copy}>{state === 'copied' ? 'Copied' : label}</Button>
      <output className={state === 'failed' ? 'text-xs text-danger' : 'sr-only'}>
        {state === 'copied'
          ? 'Copied to the clipboard.'
          : state === 'failed'
            ? 'Copy failed: select the text and press Ctrl+C (⌘C on a Mac).'
            : ''}
      </output>
    </div>
  )
}
