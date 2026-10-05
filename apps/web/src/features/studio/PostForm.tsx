// Shared by /studio/new and /studio/$id/edit: form -> preview -> publish.
import { useQueryClient } from '@tanstack/react-query'
import { CAMPUSES, LIMITS, type Campus } from '@usmfomo/shared/config'
import { formatDay } from '@usmfomo/shared/time'
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ButtonLink, Field, Input, Select, Textarea } from '../../components/ui.tsx'
import { imageSrc } from '../../lib/db.ts'
import { currentLang } from '../../lib/i18n.ts'
import { processPoster, type ProcessedPoster } from '../../lib/poster.ts'
import { STUDIO_QUERY_KEY, type StudioOrg } from '../../lib/session.ts'
import { studioErrorKey } from './errorMessage.ts'
import { PosterPicker, type PosterSelection } from './PosterPicker.tsx'
import { PostPreview, type PreviewPoster } from './PostPreview.tsx'
import {
  emptyPostValues,
  nextDaySuggestion,
  postToValues,
  toUpdatePatch,
  validatePostForm,
  withStartDate,
  type FieldErrors,
  type PostField,
  type PostFormValues,
  type ValidPost,
} from './postForm.ts'
import { studioPorts } from './ports.ts'
import { createPost, updatePost, type PosterChange, type PosterFiles } from './submitPost.ts'
import type { PostRow } from './types.ts'

type Step = 'form' | 'preview' | 'done'
type TextField = Exclude<PostField, 'campus'>

const toFiles = (p: ProcessedPoster): PosterFiles => ({ poster: p.poster, thumb: p.thumb, ext: p.format.ext, contentType: p.format.type })
const isCampus = (v: string): v is Campus => (CAMPUSES as readonly string[]).includes(v)

/** Always rendered (a live region must exist before its text changes), so a
 * pause that arrives while the form is open is announced. */
function PausedBanner({ paused }: { paused: boolean }) {
  const { t } = useTranslation('studio')
  return (
    <div aria-live="polite">
      {paused ? (
        <p className="m-0 mb-5 rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm font-semibold">
          {t('errors:posting_paused')} {t('form.pausedNoForm')}
        </p>
      ) : null}
    </div>
  )
}

/**
 * `postingEnabled` comes from my_posting_status. The pages only open the form
 * while posting is on; if the admin pauses posting meanwhile, the form stays
 * (nothing typed is lost) but uploads and publishing are disabled.
 */
export function PostForm({ org, post, postingEnabled }: { org: StudioOrg; post?: PostRow; postingEnabled: boolean }) {
  const { t } = useTranslation('studio')
  const lang = currentLang()
  const queryClient = useQueryClient()
  const ids = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const initialPoster = (): PosterSelection => (post?.poster_path ? { kind: 'existing' } : { kind: 'none' })
  const [values, setValues] = useState<PostFormValues>(() => (post ? postToValues(post) : emptyPostValues(org.campus)))
  const [endTouched, setEndTouched] = useState(Boolean(post))
  const [cancelled, setCancelled] = useState(post ? post.cancelled_at !== null : false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [summary, setSummary] = useState<string | null>(null)
  const [poster, setPoster] = useState<PosterSelection>(initialPoster)
  const [posterBusy, setPosterBusy] = useState(false)
  const [posterError, setPosterError] = useState<string | null>(null)
  const pickTicket = useRef(0)
  const [step, setStep] = useState<Step>('form')
  const [valid, setValid] = useState<ValidPost | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  // What to focus after the next render: an invalid field, a step heading, ...
  const [focusTarget, setFocusTarget] = useState<{ selector: string; n: number } | null>(null)
  const paused = !postingEnabled

  useEffect(() => {
    if (focusTarget) rootRef.current?.querySelector<HTMLElement>(focusTarget.selector)?.focus()
  }, [focusTarget])
  const focusSoon = (selector: string) => setFocusTarget((f) => ({ selector, n: (f?.n ?? 0) + 1 }))

  const clearError = (field: PostField) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const onText = (field: TextField) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.currentTarget.value
    if (field === 'startDate') setValues((v) => withStartDate(v, value, endTouched))
    else setValues((v) => ({ ...v, [field]: value }))
    if (field === 'endDate') setEndTouched(true)
    clearError(field)
  }

  const err = (field: PostField) => (errors[field] ? t(errors[field]) : null)
  const inv = (field: PostField) => (errors[field] ? true : undefined)

  const pickPoster = async (file: File) => {
    const ticket = ++pickTicket.current
    setPosterError(null)
    setPosterBusy(true)
    try {
      const processed = await processPoster(file)
      if (ticket === pickTicket.current) setPoster({ kind: 'new', processed })
    } catch (e) {
      if (ticket === pickTicket.current) setPosterError(studioErrorKey(e))
    } finally {
      if (ticket === pickTicket.current) setPosterBusy(false)
    }
  }

  const removePoster = () => {
    pickTicket.current++
    setPosterBusy(false)
    setPosterError(null)
    setPoster(post?.poster_path ? { kind: 'removed' } : { kind: 'none' })
  }

  const onPreview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (posterBusy || paused) return
    const result = validatePostForm(values, post ? { kind: 'edit', post } : { kind: 'create' })
    if (!result.ok) {
      setErrors(result.errors)
      setSummary('form.fixErrors')
      focusSoon('[aria-invalid="true"]')
      return
    }
    setErrors({})
    if (post && Object.keys(toUpdatePatch(post, result.data, cancelled)).length === 0 && poster.kind === initialPoster().kind) {
      setSummary('form.noChanges')
      focusSoon('[data-summary]')
      return
    }
    setSummary(null)
    setValid(result.data)
    setSubmitError(null)
    setStep('preview')
    focusSoon('[data-step-heading]')
  }

  const publish = async () => {
    if (submittingRef.current || !valid || paused) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (post) {
        const change: PosterChange =
          poster.kind === 'new' ? { kind: 'replace', files: toFiles(poster.processed) } : poster.kind === 'removed' ? { kind: 'remove' } : { kind: 'keep' }
        await updatePost(studioPorts, post, toUpdatePatch(post, valid, cancelled), change)
        setSavedId(post.id)
      } else {
        setSavedId(await createPost(studioPorts, org.id, valid, poster.kind === 'new' ? toFiles(poster.processed) : null))
      }
      setStep('done')
      focusSoon('[data-step-heading]')
    } catch (e) {
      setSubmitError(studioErrorKey(e))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
      // Counts (live, new in 24 h, edits) and the list changed either way.
      void queryClient.invalidateQueries({ queryKey: STUDIO_QUERY_KEY })
    }
  }

  const backToForm = () => {
    setStep('form')
    focusSoon('[data-preview-button]')
  }

  const startOver = () => {
    pickTicket.current++
    setValues(emptyPostValues(org.campus))
    setEndTouched(false)
    setErrors({})
    setSummary(null)
    setPoster({ kind: 'none' })
    setPosterBusy(false)
    setPosterError(null)
    setValid(null)
    setSavedId(null)
    setStep('form')
    focusSoon('input')
  }

  const suggestion = nextDaySuggestion(values)
  const existingUrl = imageSrc(post?.poster_path)
  const previewPoster: PreviewPoster =
    poster.kind === 'new' ? { blob: poster.processed.poster } : poster.kind === 'existing' && existingUrl ? { url: existingUrl } : null

  if (step === 'done') {
    return (
      <div ref={rootRef}>
        <section aria-labelledby={`${ids}-done`} className="flex flex-col items-start gap-3 rounded-xl border border-ok/40 bg-ok/5 p-4">
          <h2 id={`${ids}-done`} data-step-heading tabIndex={-1} className="m-0 text-lg font-bold">
            {post ? t('form.saved') : t('form.published')}
          </h2>
          <p className="m-0">{post ? t('form.savedBody') : t('form.publishedBody')}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/studio" variant="primary">
              {t('nav.backToStudio')}
            </ButtonLink>
            {savedId && !post?.hidden_at ? (
              <ButtonLink to="/e/$id" params={{ id: savedId }}>
                {t('posts.view')}
              </ButtonLink>
            ) : null}
            {!post ? <Button onClick={startOver}>{t('form.createAnother')}</Button> : null}
          </div>
        </section>
      </div>
    )
  }

  if (step === 'preview' && valid) {
    return (
      <div ref={rootRef}>
        <PausedBanner paused={paused} />
        <div className="flex flex-col gap-4">
          <h2 data-step-heading tabIndex={-1} className="m-0 text-lg font-bold">
            {t('form.previewTitle')}
          </h2>
          <p className="m-0 font-semibold text-accent">{post ? t('form.liveNoteEdit') : t('form.liveNote')}</p>
          <PostPreview data={valid} orgName={org.name} poster={previewPoster} cancelled={post ? cancelled : false} />
          {submitError ? (
            <p role="alert" className="m-0 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
              {t(submitError)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={submitting} disabled={paused} onClick={() => void publish()}>
              {post ? t('form.save') : t('form.publish')}
            </Button>
            <Button onClick={backToForm} disabled={submitting}>
              {t('form.back')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef}>
      <PausedBanner paused={paused} />
      <form noValidate onSubmit={onPreview} className="flex flex-col gap-5">
        {summary ? (
          <p data-summary tabIndex={-1} role="alert" className="m-0 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
            {t(summary)}
          </p>
        ) : null}

        <Field label={t('form.eventName')} error={err('title')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={inv('title')}
              value={values.title}
              onChange={onText('title')}
              maxLength={LIMITS.titleMax}
              autoComplete="off"
            />
          )}
        </Field>

        <p id={`${ids}-myt`} className="m-0 text-sm font-semibold text-sky">
          {t('common:time.mytNote')}
        </p>
        <fieldset aria-describedby={`${ids}-myt`} className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 p-0 text-base font-bold">{t('form.starts')}</legend>
          <Field label={t('form.startDate')} error={err('startDate')}>
            {({ id, describedBy }) => (
              <Input id={id} type="date" aria-describedby={describedBy} aria-invalid={inv('startDate')} value={values.startDate} onChange={onText('startDate')} />
            )}
          </Field>
          <Field label={t('form.startTime')} error={err('startTime')}>
            {({ id, describedBy }) => (
              <Input id={id} type="time" aria-describedby={describedBy} aria-invalid={inv('startTime')} value={values.startTime} onChange={onText('startTime')} />
            )}
          </Field>
        </fieldset>
        <fieldset aria-describedby={`${ids}-myt`} className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 p-0 text-base font-bold">{t('form.ends')}</legend>
          <Field label={t('form.endDate')} error={err('endDate')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="date"
                aria-describedby={describedBy}
                aria-invalid={inv('endDate')}
                value={values.endDate}
                min={values.startDate || undefined}
                onChange={onText('endDate')}
              />
            )}
          </Field>
          <Field label={t('form.endTime')} error={err('endTime')}>
            {({ id, describedBy }) => (
              <Input id={id} type="time" aria-describedby={describedBy} aria-invalid={inv('endTime')} value={values.endTime} onChange={onText('endTime')} />
            )}
          </Field>
        </fieldset>
        {suggestion ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky/40 bg-sky/5 p-3 text-sm">
            <span>{t('form.endsNextDay')}</span>
            <Button
              onClick={() => {
                setValues((v) => ({ ...v, endDate: suggestion }))
                setEndTouched(true)
                clearError('endDate')
                clearError('endTime')
              }}
            >
              {t('form.setNextDay', { day: formatDay(`${suggestion}T12:00:00+08:00`, lang) })}
            </Button>
          </div>
        ) : null}

        <Field label={t('form.venue')} hint={t('form.venueHint')} error={err('venue')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={inv('venue')}
              value={values.venue}
              onChange={onText('venue')}
              maxLength={LIMITS.venueMax}
              autoComplete="off"
            />
          )}
        </Field>

        <Field label={t('form.campus')} error={err('campus')}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={inv('campus')}
              value={values.campus}
              onChange={(e) => {
                const value = e.currentTarget.value
                if (isCampus(value)) setValues((v) => ({ ...v, campus: value }))
                clearError('campus')
              }}
            >
              {CAMPUSES.map((c) => (
                <option key={c} value={c}>
                  {t(`common:campus.${c}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label={t('form.description')}
          hint={`${t('form.descriptionHint')} (${values.description.length}/${LIMITS.descriptionMax})`}
          error={err('description')}
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={inv('description')}
              value={values.description}
              onChange={onText('description')}
              maxLength={LIMITS.descriptionMax}
              rows={5}
            />
          )}
        </Field>

        <Field label={t('form.link')} hint={t('form.linkHint')} error={err('link_url')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              aria-describedby={describedBy}
              aria-invalid={inv('link_url')}
              value={values.link_url}
              onChange={onText('link_url')}
              maxLength={LIMITS.linkMax}
              placeholder="https://"
            />
          )}
        </Field>

        <PosterPicker
          selection={poster}
          busy={posterBusy}
          error={posterError}
          existingUrl={existingUrl}
          disabled={paused}
          onPick={(file) => void pickPoster(file)}
          onRemove={removePoster}
          onUndoRemove={() => setPoster({ kind: 'existing' })}
        />

        {post ? (
          <div className="flex items-start gap-3">
            <input
              id={`${ids}-cancelled`}
              type="checkbox"
              checked={cancelled}
              onChange={(e) => setCancelled(e.currentTarget.checked)}
              aria-describedby={`${ids}-cancelled-hint`}
              className="mt-0.5 h-6 w-6 shrink-0 accent-accent"
            />
            <div className="flex flex-col">
              <label htmlFor={`${ids}-cancelled`} className="text-sm font-semibold">
                {t('form.cancelled')}
              </label>
              <span id={`${ids}-cancelled-hint`} className="text-xs text-muted">
                {t('form.cancelledHint')}
              </span>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" data-preview-button disabled={posterBusy || paused}>
            {t('form.preview')}
          </Button>
          <ButtonLink to="/studio">{t('form.discard')}</ButtonLink>
        </div>
      </form>
    </div>
  )
}
