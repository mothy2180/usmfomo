import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx.ts'
import { currentLang, setLanguage } from '../lib/i18n.ts'

/**
 * EN | BM toggle buttons. The group doesn't clip its content: the focus ring
 * is drawn outside the button, so the outer buttons round their own corners
 * instead, and the focused button sits above its neighbour, ring included.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t } = useTranslation()
  const lang = currentLang()
  return (
    // A named group is the ARIA pattern for toggle buttons; a <fieldset>
    // would need a visible legend.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <div role="group" aria-label={t('lang.label')} className={cx('inline-flex rounded-lg border border-line text-xs', className)}>
      {(['en', 'ms'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLanguage(l)}
          className={cx(
            'relative px-2 py-1 first:rounded-l-md last:rounded-r-md focus-visible:z-10',
            lang === l ? 'bg-surface-2 font-semibold text-text' : 'text-muted hover:text-text',
          )}
        >
          {l === 'en' ? 'EN' : 'BM'}
        </button>
      ))}
    </div>
  )
}
