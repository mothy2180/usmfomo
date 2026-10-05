import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LIMITS } from '@usmfomo/shared/config'
import { mytInputToIso } from '@usmfomo/shared/time'
import { useId, useState, type ChangeEvent, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import { Button, Field, FormError, Input, Textarea } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { formatMytDateTime } from '../../lib/format.ts'
import { firstInvalid, type FieldErrors } from '../../lib/forms.ts'
import { errorMessage } from '../../lib/messages.ts'
import {
  defaultNoticeValues,
  NOTICE_FIELDS,
  noticeToValues,
  validateNotice,
  type NoticeData,
  type NoticeFormValues,
} from '../../lib/notices.ts'
import { createNotice, qk, updateNotice, type NoticeRow } from '../../lib/queries.ts'

type FieldName = (typeof NOTICE_FIELDS)[number]

/** "from … until …" in words, so AM/PM or date slips are easy to spot. */
function preview(v: NoticeFormValues): string | null {
  try {
    const start = mytInputToIso(v.startDate, v.startTime)
    const end = mytInputToIso(v.endDate, v.endTime)
    return `Shown from ${formatMytDateTime(start)} until ${formatMytDateTime(end)} (MYT).`
  } catch {
    return null
  }
}

export function NoticeDialog({ notice, onClose }: { notice: NoticeRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const formId = useId()
  const [values, setValues] = useState<NoticeFormValues>(() => (notice ? noticeToValues(notice) : defaultNoticeValues(new Date())))
  const [errors, setErrors] = useState<FieldErrors>({})
  const id = (field: FieldName) => `${formId}-${field}`

  const mutation = useMutation({
    mutationFn: (data: NoticeData) => (notice ? updateNotice(notice.id, data) : createNotice(data)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notices })
      void queryClient.invalidateQueries({ queryKey: qk.status })
      onClose()
      announce(notice ? 'Notice saved.' : 'Notice created.')
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (mutation.isPending) return
    const result = validateNotice(values, new Date())
    if (!result.ok) {
      setErrors(result.errors)
      const first = firstInvalid(NOTICE_FIELDS, result.errors)
      if (first) document.getElementById(id(first))?.focus()
      return
    }
    setErrors({})
    mutation.mutate(result.data)
  }

  const bind = (field: keyof NoticeFormValues) => ({
    value: values[field],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.currentTarget.value
      setValues((v) => ({ ...v, [field]: value }))
    },
  })
  const range = preview(values)

  return (
    <Dialog open title={notice ? 'Edit notice' : 'New notice'} onClose={onClose} preventEscape={mutation.isPending}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          id={id('title')}
          label="Title"
          hint={`${values.title.trim().length} of 3–${LIMITS.noticeTitleMax} characters`}
          error={errors.title}
        >
          {({ id: inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              {...bind('title')}
              maxLength={LIMITS.noticeTitleMax}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          id={id('body')}
          label="Message"
          hint={`${values.body.trim().length} of ${LIMITS.noticeBodyMax} characters; line breaks are kept.`}
          error={errors.body}
        >
          {({ id: inputId, describedBy, invalid }) => (
            <Textarea
              id={inputId}
              {...bind('body')}
              rows={5}
              maxLength={LIMITS.noticeBodyMax}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          id={id('link_url')}
          label="Link (optional)"
          hint="A full https:// address, e.g. a form or an official post."
          error={errors.link_url}
        >
          {({ id: inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              {...bind('link_url')}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={LIMITS.linkMax}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <p className="m-0 text-sm font-semibold">Times are Malaysia time (MYT), whatever this device’s time zone.</p>
        <DateTime
          legend="Show from"
          dateId={id('startDate')}
          timeId={id('startTime')}
          date={bind('startDate')}
          time={bind('startTime')}
          dateError={errors.startDate}
          timeError={errors.startTime}
        />
        <DateTime
          legend="Show until"
          dateId={id('endDate')}
          timeId={id('endTime')}
          date={bind('endDate')}
          time={bind('endTime')}
          dateError={errors.endDate}
          timeError={errors.endTime}
        />
        {range ? <p className="m-0 text-sm text-muted">{range}</p> : null}

        <FormError message={mutation.isError ? errorMessage(mutation.error) : null} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={mutation.isPending}>
            {notice ? 'Save notice' : 'Create notice'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

type Bound = { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void }

function DateTime({
  legend,
  dateId,
  timeId,
  date,
  time,
  dateError,
  timeError,
}: {
  legend: string
  dateId: string
  timeId: string
  date: Bound
  time: Bound
  dateError?: string
  timeError?: string
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-semibold">{legend} (MYT)</legend>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1 basis-40">
          <Field id={dateId} label="Date" error={dateError}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="date" {...date} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
            )}
          </Field>
        </div>
        <div className="min-w-0 flex-1 basis-32">
          <Field id={timeId} label="Time" error={timeError}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="time" step={60} {...time} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
            )}
          </Field>
        </div>
      </div>
    </fieldset>
  )
}
