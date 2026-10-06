import type { OrgType } from '@usmfomo/shared/config'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx.ts'
import { matchOrgs } from './orgMatch.ts'
import type { OrgSummary } from './types.ts'

type Props = {
  /** id of the <input>, so an outside <label for> names the combobox. */
  inputId: string
  describedBy?: string
  orgs: readonly OrgSummary[]
  /** Only suggest organisers of this type (mobile: the current tab). */
  type?: OrgType
  /** Label each suggestion with Club/School (desktop: both types listed). */
  showType?: boolean
  selectedId?: string
  onSelect: (org: OrgSummary | undefined) => void
  /** The input got focus (the dashboard fetches the organiser list then). */
  onFocus?: () => void
  loading?: boolean
}

/**
 * Organiser type-ahead: an ARIA 1.2 combobox with a listbox popup (WAI-ARIA
 * APG "list autocomplete"). Focus stays in the input; arrows move the active
 * option (aria-activedescendant), Enter picks it, Escape closes or clears.
 * Emptying the input removes the organiser filter.
 */
export function OrgCombobox({ inputId, describedBy, orgs, type, showType, selectedId, onSelect, onFocus, loading }: Props) {
  const { t } = useTranslation('dashboard')
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = `${inputId}-list`
  const selected = useMemo(() => orgs.find((o) => o.id === selectedId), [orgs, selectedId])
  const selectedName = selected?.name ?? ''

  const [text, setText] = useState(selectedName)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  // Follow changes from outside (Clear filters, back button, the list arriving).
  const [shownName, setShownName] = useState(selectedName)
  if (shownName !== selectedName) {
    setShownName(selectedName)
    setText(selectedName)
  }

  // While the input still shows the chosen organiser, suggest everything.
  const query = text === selectedName ? '' : text
  const { items, more } = useMemo(() => matchOrgs(orgs, query, { type }), [orgs, query, type])
  const activeIndex = active < items.length ? active : -1
  const activeOrg = activeIndex >= 0 ? items[activeIndex] : undefined
  const optionId = (org: OrgSummary) => `${inputId}-opt-${org.id}`

  useEffect(() => {
    if (!open || !activeOrg) return
    // Optional call: jsdom (tests) has no scrollIntoView.
    document.getElementById(`${inputId}-opt-${activeOrg.id}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeOrg, inputId])

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  const choose = (org: OrgSummary) => {
    setText(org.name)
    close()
    if (org.id !== selectedId) onSelect(org)
  }

  const clear = () => {
    setText('')
    close()
    if (selectedId) onSelect(undefined)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setOpen(true)
        setActive(!open || n === 0 ? (n > 0 ? 0 : -1) : (activeIndex + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        setOpen(true)
        setActive(n === 0 ? -1 : !open || activeIndex <= 0 ? n - 1 : activeIndex - 1)
        break
      case 'Enter':
        if (open && activeOrg) {
          e.preventDefault()
          choose(activeOrg)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          close()
        } else if (text) {
          e.preventDefault()
          clear()
        }
        break
      case 'Tab':
        close()
        break
    }
  }

  const statusText = !open || loading
    ? ''
    : items.length === 0
      ? t('filters.organiserNone')
      : t('filters.organisersFound', { count: items.length })

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && activeOrg ? optionId(activeOrg) : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        placeholder={loading ? t('filters.organiserLoading') : t('filters.organiserPlaceholder')}
        onChange={(e) => {
          const value = e.target.value
          setText(value)
          setOpen(true)
          setActive(value.trim() ? 0 : -1)
          if (!value.trim() && selectedId) onSelect(undefined)
        }}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onClick={() => setOpen(true)}
        onBlur={() => {
          close()
          setText(selectedName)
        }}
        className={cx(
          'w-full min-h-11 rounded-lg border border-field-line bg-ink px-3 py-2 text-sm text-text placeholder:text-muted/70',
          selected && 'pr-12',
        )}
      />
      {selected ? (
        <button
          type="button"
          onClick={clear}
          aria-label={t('filters.clearOrganiser', { name: selected.name })}
          className="absolute right-0.5 top-0.5 inline-flex size-10 items-center justify-center rounded-md text-lg leading-none text-muted hover:text-text"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <div
        hidden={!open}
        className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-xl shadow-black/40"
      >
        {/* APG combobox popup. A native <select>/<datalist> can't filter or label
            options like this; the options take no focus and no keys of their own
            because focus stays in the input (aria-activedescendant). */}
        {/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
        <div id={listId} role="listbox" aria-label={t('filters.organiserList')} className="max-h-72 overflow-y-auto p-1">
          {items.map((org, i) => (
            <div
              key={org.id}
              id={optionId(org)}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(org)}
              className={cx(
                'flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-text',
                // The option Enter would pick. Focus stays in the input, so it
                // needs its own clear outline (sky on surface is over 10:1).
                i === activeIndex && 'bg-surface-2 ring-2 ring-sky ring-inset',
                org.id === selectedId && 'font-semibold',
              )}
            >
              <span className="min-w-0 wrap-anywhere">{org.name}</span>
              {showType ? <span className="shrink-0 text-xs text-muted">{t(`common:orgType.${org.type}One`)}</span> : null}
            </div>
          ))}
        </div>
        {/* oxlint-enable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
        {items.length === 0 ? (
          <p className="m-0 px-4 py-3 text-sm text-muted">{loading ? t('filters.organiserLoading') : t('filters.organiserNone')}</p>
        ) : null}
        {more ? <p className="m-0 border-t border-line px-4 py-2 text-xs text-muted">{t('filters.organiserMore')}</p> : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {statusText}
      </span>
    </div>
  )
}
