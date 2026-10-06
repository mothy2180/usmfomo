import { useId, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Button, Callout, Checkbox, Field, FormError, Input, RadioGroup, Select } from '../../components/ui.tsx'
import type { AccountRow } from '../../lib/api.ts'
import { adminApi } from '../../lib/db.ts'
import { firstInvalid, type FieldErrors } from '../../lib/forms.ts'
import { CAMPUS_LABELS, ORG_CAMPUSES, TYPE_OPTIONS } from '../../lib/labels.ts'
import { errorMessage } from '../../lib/messages.ts'
import { reportSessionProblem } from '../../lib/sessionEvents.ts'
import { describeOrgChanges, ORG_EDIT_FIELDS, orgEditSchema, orgEditValues, validateOrgEdit, type OrgEditValues } from './accountForms.ts'

type Props = {
  account: AccountRow
  accounts: readonly AccountRow[]
  /** Lets the dialog refuse to close while saving. */
  onBusy: (busy: boolean) => void
  onCancel: () => void
  onSaved: () => void
}

export function EditOrgForm(props: Props) {
  const initial = orgEditValues(props.account)
  if (!initial || !props.account.org_id) {
    return <p className="m-0 text-sm">This account has no organisation to edit.</p>
  }
  return <EditOrgFields {...props} orgId={props.account.org_id} initial={initial} />
}

function EditOrgFields({ accounts, onBusy, onCancel, onSaved, orgId, initial }: Props & { orgId: string; initial: OrgEditValues }) {
  const formId = useId()
  const [values, setValues] = useState<OrgEditValues>(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids: Record<(typeof ORG_EDIT_FIELDS)[number], string> = {
    name: `${formId}-name`,
    slug: `${formId}-slug`,
    type: `${formId}-type`,
    campus: `${formId}-campus`,
    active: `${formId}-active`,
  }

  const preview = orgEditSchema.safeParse(values)
  const changes = preview.success ? describeOrgChanges(initial, preview.data) : []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const result = validateOrgEdit(values, orgId, accounts)
    if (!result.ok) {
      // Commit the errors first, so the field is already invalid (and
      // described by its error) when it receives focus.
      flushSync(() => setErrors(result.errors))
      const first = firstInvalid(ORG_EDIT_FIELDS, result.errors)
      if (first) document.getElementById(ids[first])?.focus()
      return
    }
    setErrors({})
    if (!describeOrgChanges(initial, result.data).length) {
      setError('Nothing has changed.')
      return
    }
    setBusy(true)
    onBusy(true)
    try {
      await adminApi.updateOrg({ orgId, ...result.data })
      onSaved()
    } catch (err) {
      reportSessionProblem(err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field id={ids.name} label="Organisation name" error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={values.name}
            maxLength={100}
            onChange={(e) => {
              const name = e.currentTarget.value
              setValues((v) => ({ ...v, name }))
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <Field
        id={ids.slug}
        label="Public link (slug)"
        hint="Changing it changes the organisation’s page address /o/…; old links stop working."
        error={errors.slug}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={values.slug}
            maxLength={50}
            onChange={(e) => {
              const slug = e.currentTarget.value
              setValues((v) => ({ ...v, slug }))
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="font-mono"
          />
        )}
      </Field>
      <RadioGroup
        id={ids.type}
        legend="Type"
        name={`${formId}-type-radio`}
        value={values.type}
        options={TYPE_OPTIONS}
        onChange={(type) => setValues((v) => ({ ...v, type }))}
        error={errors.type}
      />
      <Field id={ids.campus} label="Home campus" error={errors.campus}>
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            value={values.campus}
            onChange={(e) => {
              const campus = ORG_CAMPUSES.find((c) => c === e.currentTarget.value) ?? 'main'
              setValues((v) => ({ ...v, campus }))
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          >
            {ORG_CAMPUSES.map((c) => (
              <option key={c} value={c}>
                {CAMPUS_LABELS[c]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox
        label="Active"
        hint="Listed on the public site with its posts, and its account may post. Unticked hides the organisation and all of its posts, and stops posting."
        checked={values.active}
        onChange={(active) => setValues((v) => ({ ...v, active }))}
      />
      {changes.length ? (
        <Callout tone={values.active ? 'info' : 'warn'} title="You are changing">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <FormError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          Save changes
        </Button>
      </div>
    </form>
  )
}
