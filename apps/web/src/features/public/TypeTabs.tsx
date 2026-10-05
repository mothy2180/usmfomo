import { ORG_TYPES, type OrgType } from '@usmfomo/shared/config'
import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx.ts'
import { panelId, tabId } from './domIds.ts'

type Props = {
  idPrefix: string
  active: OrgType
  onSelect: (type: OrgType) => void
  counts: Partial<Record<OrgType, number>>
}

/** Clubs | Schools tabs (mobile). WAI-ARIA APG tabs with automatic
 * activation: arrows, Home and End move between tabs; one tab stop. */
export function TypeTabs({ idPrefix, active, onSelect, counts }: Props) {
  const { t } = useTranslation('dashboard')
  const refs = useRef<Partial<Record<OrgType, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = ORG_TYPES.indexOf(active)
    const last = ORG_TYPES.length - 1
    const target =
      e.key === 'ArrowRight' ? ORG_TYPES[i === last ? 0 : i + 1]
      : e.key === 'ArrowLeft' ? ORG_TYPES[i === 0 ? last : i - 1]
      : e.key === 'Home' ? ORG_TYPES[0]
      : e.key === 'End' ? ORG_TYPES[last]
      : undefined
    if (!target) return
    e.preventDefault()
    onSelect(target)
    refs.current[target]?.focus()
  }

  return (
    <div role="tablist" aria-label={t('dashboard.tabsLabel')} className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
      {ORG_TYPES.map((type) => {
        const selected = type === active
        const count = counts[type]
        return (
          <button
            key={type}
            ref={(el) => {
              refs.current[type] = el
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, type)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, type)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(type)}
            onKeyDown={onKeyDown}
            className={cx(
              'min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              selected ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {t(`common:orgType.${type}`)}
            {/* The space sits outside the span: accessible names drop it inside. */}
            {count !== undefined ? (
              <>
                {' '}
                <span className="font-normal">({count})</span>
              </>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
