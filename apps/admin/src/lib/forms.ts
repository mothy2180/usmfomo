// zod issues -> one English message per field. The shared schemas use stable
// message codes ('username_format', 'too_short', ...) instead of prose.

export type FieldErrors = Partial<Record<string, string>>

/** Result of a form validation: the parsed data, or one message per field. */
export type Validated<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors }

export const VALIDATION_MESSAGES: Record<string, string> = {
  username_format:
    'Use 3–32 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit.',
  slug_format: 'Use 1–50 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit.',
  too_short: 'This is too short.',
  too_long_text: 'This is too long.',
  bad_chars: 'Remove tabs and other invisible control characters.',
  campus_physical: 'Choose a physical campus.',
  link_format: 'Use a full https:// link with no spaces (no http://, no user@ part).',
  date_format: 'Enter a valid date.',
  time_format: 'Enter a valid time.',
  end_before_start: 'The end must be after the start.',
  too_long_notice: 'A notice can be shown for at most 180 days.',
  end_in_past: 'Choose an end time in the future.',
}

type Issue = { readonly path: ReadonlyArray<PropertyKey>; readonly message: string }

/** First issue per top-level field wins. */
export function fieldErrors(issues: ReadonlyArray<Issue>): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form'
    if (!out[key]) out[key] = VALIDATION_MESSAGES[issue.message] ?? 'This value is not valid.'
  }
  return out
}

/** Ids of the fields that have errors, in form order (for focusing the first). */
export function firstInvalid<K extends string>(order: readonly K[], errors: FieldErrors): K | null {
  return order.find((k) => errors[k]) ?? null
}
