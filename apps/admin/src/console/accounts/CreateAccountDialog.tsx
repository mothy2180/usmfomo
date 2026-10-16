import { useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Dialog } from '../../components/Dialog.tsx'
import { PasswordField } from '../../components/PasswordField.tsx'
import { ShowOncePassword } from '../../components/ShowOncePassword.tsx'
import { Button, Field, FormError, Input, RadioGroup, Select } from '../../components/ui.tsx'
import { PUBLIC_SITE_URL } from '../../env.ts'
import { useAnnounce } from '../../lib/announce.ts'
import type { AccountRow } from '../../lib/api.ts'
import { adminApi } from '../../lib/db.ts'
import { firstInvalid, type FieldErrors } from '../../lib/forms.ts'
import { CAMPUS_LABELS, ORG_CAMPUSES, TYPE_OPTIONS } from '../../lib/labels.ts'
import { errorMessage } from '../../lib/messages.ts'
import { qk } from '../../lib/queries.ts'
import { reportSessionProblem } from '../../lib/sessionEvents.ts'
import {
  CREATE_FIELDS,
  INITIAL_CREATE,
  INITIAL_SLUG,
  slugAfterNameChange,
  slugAfterSlugChange,
  slugSuggestion,
  validateCreate,
  validateTypedPassword,
  type CreateValues,
} from './accountForms.ts'

/** Form order for focusing the first invalid field: the account fields, then the password. */
const FIELDS = [...CREATE_FIELDS, 'password'] as const

type Created = { username: string; password: string; orgName: string }

/** Create an organisation and its account; the password (typed or generated) is shown once. */
export function CreateAccountDialog({ accounts, onClose }: { accounts: readonly AccountRow[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const formId = useId()
  const [values, setValues] = useState<Omit<CreateValues, 'orgSlug'>>(INITIAL_CREATE)
  const [slug, setSlug] = useState(INITIAL_SLUG)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)

  const ids: Record<(typeof FIELDS)[number], string> = {
    orgName: `${formId}-org`,
    orgSlug: `${formId}-slug`,
    username: `${formId}-user`,
    type: `${formId}-type`,
    campus: `${formId}-campus`,
    password: `${formId}-password`,
  }
  const suggestion = slugSuggestion(slug, values.orgName)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const result = validateCreate({ ...values, orgSlug: slug.slug }, accounts)
    const typed = validateTypedPassword(password)
    if (!result.ok || !typed.ok) {
      const found = { ...(result.ok ? {} : result.errors), ...(typed.ok ? {} : typed.errors) }
      // Commit the errors first, so the field is already invalid (and
      // described by its error) when it receives focus.
      flushSync(() => setErrors(found))
      const first = firstInvalid(FIELDS, found)
      if (first) document.getElementById(ids[first])?.focus()
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const account = await adminApi.createAccount(result.data, typed.data)
      // The password is in `created` now; drop the form's copy.
      setPassword('')
      setCreated({ username: account.username, password: account.password, orgName: result.data.orgName })
      void queryClient.invalidateQueries({ queryKey: qk.accounts })
      void queryClient.invalidateQueries({ queryKey: qk.status })
    } catch (err) {
      reportSessionProblem(err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function done() {
    const name = created?.orgName
    // Drop the password from state before the dialog goes away.
    setCreated(null)
    onClose()
    announce(name ? `Account for ${name} created.` : 'Account created.')
  }

  if (created) {
    return (
      <Dialog open title="Account created" onClose={done} focusKey="created" preventEscape>
        <ShowOncePassword
          username={created.username}
          password={created.password}
          lead={`${created.orgName} can now sign in at ${PUBLIC_SITE_URL.replace(/^https?:\/\//, '')}/login with this username and password.`}
          onDone={done}
        />
      </Dialog>
    )
  }

  return (
    <Dialog open title="Create an account" onClose={onClose} focusKey="form" preventEscape={busy}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          id={ids.orgName}
          label="Organisation name"
          hint="As students know it, e.g. “Robotics Club” or “School of Computer Sciences”."
          error={errors.orgName}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={values.orgName}
              maxLength={100}
              onChange={(e) => {
                const orgName = e.currentTarget.value
                setValues((v) => ({ ...v, orgName }))
                setSlug((s) => slugAfterNameChange(s, orgName))
              }}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          id={ids.orgSlug}
          label="Public link (slug)"
          hint={
            <>
              Follows the name until you edit it. Page: <span className="break-all font-mono">/o/{slug.slug || '…'}</span>
            </>
          }
          error={errors.orgSlug}
        >
          {({ id, describedBy, invalid }) => (
            <div className="flex flex-wrap items-start gap-2">
              <Input
                id={id}
                value={slug.slug}
                maxLength={50}
                onChange={(e) => setSlug(slugAfterSlugChange(e.currentTarget.value, values.orgName))}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                className="min-w-0 flex-1 basis-56 font-mono"
              />
              {suggestion ? (
                <Button onClick={() => setSlug({ slug: suggestion, follows: true })}>
                  Use <span className="font-mono">{suggestion}</span>
                </Button>
              ) : null}
            </div>
          )}
        </Field>
        <Field
          id={ids.username}
          label="Username"
          hint="What they sign in with: 3–32 lowercase letters, digits or hyphens. Only you can change it later (Manage → Change username)."
          error={errors.username}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={values.username}
              maxLength={32}
              onChange={(e) => {
                const username = e.currentTarget.value
                setValues((v) => ({ ...v, username }))
              }}
              autoComplete="off"
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
        <Field id={ids.campus} label="Home campus" hint="Each post still picks its own campus, including Online." error={errors.campus}>
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
        <PasswordField
          id={ids.password}
          label="Password"
          value={password}
          onChange={(next) => {
            setPassword(next)
            setErrors((e) => ({ ...e, password: undefined }))
          }}
          error={errors.password}
          disabled={busy}
        />
        <FormError message={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Create account
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
