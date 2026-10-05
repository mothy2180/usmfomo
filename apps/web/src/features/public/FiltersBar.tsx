import { CAMPUSES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Input, Select } from '../../components/ui.tsx'
import type { DashboardSearch } from '../../router.tsx'
import { OrgCombobox } from './OrgCombobox.tsx'
import { hasActiveFilters } from './search.ts'
import type { OrgSummary } from './types.ts'

/** Typing pauses this long before the search runs. */
export const SEARCH_DEBOUNCE_MS = 300
const Q_MAX = 100

const normalizeQ = (value: string) => value.trim().slice(0, Q_MAX).trim()

type Props = {
  search: DashboardSearch
  onQuery: (q: string | undefined) => void
  onCampus: (campus: Campus | undefined) => void
  onOrg: (org: OrgSummary | undefined) => void
  onClear: () => void
  orgs: readonly OrgSummary[]
  orgsLoading: boolean
  /** The organiser field was focused: time to fetch the organiser list. */
  onOrgsWanted?: () => void
  /** Restrict organiser suggestions to one type (mobile tabs); undefined = all. */
  orgType?: OrgType
}

export function FiltersBar({ search, onQuery, onCampus, onOrg, onClear, orgs, orgsLoading, onOrgsWanted, orgType }: Props) {
  const { t } = useTranslation('dashboard')
  const formRef = useRef<HTMLFormElement>(null)
  const [text, setText] = useState(search.q ?? '')
  // The q we last put in the URL: lets us tell our own echo from an outside
  // change (Clear filters, back/forward) without fighting the user's typing.
  const sent = useRef(search.q ?? '')

  useEffect(() => {
    const q = search.q ?? ''
    if (q !== sent.current) {
      sent.current = q
      setText(q)
    }
  }, [search.q])

  useEffect(() => {
    const q = normalizeQ(text)
    if (q === sent.current) return
    const timer = window.setTimeout(() => {
      if (q === sent.current) return
      sent.current = q
      onQuery(q || undefined)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text, onQuery])

  const submitNow = () => {
    const q = normalizeQ(text)
    if (q === sent.current) return
    sent.current = q
    onQuery(q || undefined)
  }

  return (
    // The <search> landmark carries the name; an unnamed <form> adds no second landmark.
    <search aria-label={t('filters.label')} className="mt-6 block">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          submitNow()
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] lg:items-end"
      >
        <Field label={t('filters.search')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="search"
              enterKeyHint="search"
              maxLength={Q_MAX}
              value={text}
              placeholder={t('filters.searchPlaceholder')}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('filters.campus')}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={search.campus ?? ''}
              onChange={(e) => onCampus((CAMPUSES as readonly string[]).includes(e.target.value) ? (e.target.value as Campus) : undefined)}
            >
              <option value="">{t('common:campus.all')}</option>
              {CAMPUSES.map((c) => (
                <option key={c} value={c}>
                  {t(`common:campus.${c}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('filters.organiser')}>
          {({ id, describedBy }) => (
            <OrgCombobox
              inputId={id}
              describedBy={describedBy}
              orgs={orgs}
              type={orgType}
              showType={!orgType}
              selectedId={search.org}
              onSelect={onOrg}
              onFocus={onOrgsWanted}
              loading={orgsLoading}
            />
          )}
        </Field>
        {hasActiveFilters(search) ? (
          <Button
            onClick={() => {
              onClear()
              // The button disappears; keep focus in the filters.
              formRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
            }}
            className="sm:col-span-2 sm:justify-self-start lg:col-span-1"
          >
            {t('filters.clear')}
          </Button>
        ) : null}
      </form>
    </search>
  )
}
