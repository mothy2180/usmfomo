# usmfomo — component contracts

Interfaces between the parts of usmfomo. The database (`supabase/migrations`)
is the authority for every rule; this file describes how the other parts talk
to it and to each other. Change a contract here first, then the code.

## Components and where they live

| Component | Path | Runs on | Talks to |
|---|---|---|---|
| Public site + club studio | `apps/web` | Cloudflare Pages `usmfomo` | Supabase REST/Auth/Storage (publishable key + club session) |
| Image proxy | `apps/web/functions/i/[[path]].ts` → `apps/web/edge/image-proxy.ts` | Pages Function | Supabase public bucket URL |
| Owner console | `apps/admin` | Cloudflare Pages `usmfomo-admin` | Supabase REST/Auth + `owner-admin` function |
| Shared code | `packages/shared` | imported by both apps | — |
| maintenance function | `supabase/functions/maintenance` | Supabase Edge (Deno) | `maint_*` RPCs (secret key), Storage API |
| owner-admin function | `supabase/functions/owner-admin` | Supabase Edge (Deno) | Auth Admin API, `admin_*` RPCs, Storage API |
| Cron Worker | `workers/cron` | Cloudflare Worker `usmfomo-cron` (no URL) | Supabase REST (anon) + maintenance function |
| Owner CLI | `scripts/account.ts` | the owner's laptop (Node 26) | Auth Admin API, `admin_*` RPCs, Storage API |

## Keys and identities

- Browsers only ever hold the **publishable** key (`sb_publishable_…`).
- Edge Functions read the secret key from `SUPABASE_SECRET_KEYS` (JSON object
  keyed by name) and the project URL from `SUPABASE_URL`. They use the key named
  `default`; without one, the only `sb_secret_` key (a replacement created under
  another name). Several secret keys and none named `default` is an error, and
  so is a `default` that is not a secret key. Never `SUPABASE_SERVICE_ROLE_KEY`
  (legacy, absent on new projects).
- New API keys go in the `apikey` header only. A user's access token goes in
  `Authorization: Bearer`. Never put an `sb_` key in `Authorization`.
- Logins are usernames: `username` → `username@usmfomo.pages.dev`
  (`usernameToEmail` in `packages/shared`). No email is ever sent.
- Passwords change only through the owner's tools (owner-admin `reset_password`
  and `handover`, the owner CLI). A trigger on `auth.users` (0052) refuses any
  new password without a one-time grant from `admin_allow_password_change`
  (service role only, valid 60 seconds, used up by the change), which those
  tools call right before the Auth Admin API update. So a signed-in user's own
  `PUT /auth/v1/user { password }` (supabase-js `auth.updateUser`) fails with
  500 `{ code: 'P0001', message: 'password_change_refused' }` and changes
  nothing, for clubs, schools and the owner alike. Sign-in, bans and other
  updates that keep the hash are unaffected; when Auth re-encrypts a stored
  hash at sign-in (its encryption at rest), the stored hash is kept.

## Database API used by the apps (PostgREST, RLS applies)

Public (anon, `publicDb` in `apps/web/src/lib/db.ts`):
- `rpc('search_posts', { p_type, p_q?, p_campus?, p_org?, p_limit≤50, p_offset })`
  → cards with `org_name, org_slug, thumb_path, total` (full count each page).
- `from('posts').select(...).eq('id', id).maybeSingle()` — event page; embed the
  org with `org:orgs(id,name,slug,type)`. Missing row = ended/removed/hidden.
- `from('notices').select('id,title,body,link_url,starts_at,ends_at,updated_at')`
- `from('orgs').select('id,name,slug,type,campus')` — active orgs only (RLS);
  paged with `range()` in steps of 100 and loaded only when the organiser filter
  is used.
- `from('site_settings').select('public_reads_enabled')` — read only when a page
  comes back empty, to say "events are hidden for a while" in degraded mode.

Club studio (`studioDb`, session in sessionStorage):
- `rpc('my_posting_status')` → `{ state: 'ok'|'mfa_required'|'inactive'|'session_ended'|'no_account'|'owner'|'anonymous', username, org{id,name,slug,type,campus}, posting_enabled, live, live_limit, new_24h, new_limit, next_slot_at, edits_24h, edits_limit, factors }`
- `from('posts')` insert/update/delete with the column grants in 0020
  (`campus,title,venue,description,link_url,starts_at,ends_at,poster_path,thumb_path,cancelled_at`).
  Own posts (including hidden/expired-but-not-purged) are readable with
  `.eq('org_id', status.org.id)`.
- Storage bucket `posters`: upload `${orgId}/${uuid}.webp|jpg` and
  `${orgId}/${uuid}-thumb.webp|jpg` with `{ upsert: false, cacheControl: '3600', contentType }`;
  `remove([...])` for own files. Max 2 MiB, WebP/JPEG only, 40 objects per org.
- Errors: `errorKey()` from `@usmfomo/shared/errors` → i18n key under `errors:`.

Owner console (owner session, aal2):
- At aal1, right after the password step: `rpc('my_posting_status')`. Any club
  or school state means "not the owner" (sign out with scope local), so a club
  is never pushed into enrolling 2FA here. The binding check stays owner-admin
  `status` at aal2.
- `from('posts')` select (all rows) and update `hidden_at` (hide/unhide).
- `from('notices')` select/insert/update/delete.
- `from('site_settings')` select/update `posting_enabled`, `public_reads_enabled`.
- Everything else goes through the `owner-admin` function.

## `owner-admin` Edge Function

`POST /functions/v1/owner-admin`, JSON body `{ "action": string, ...params }`.
Call with `supabase.functions.invoke('owner-admin', { body })` from an owner
session (it sends `Authorization: Bearer <access token>` and `apikey`).

Authorisation, in this order (any failure stops the request):
1. CORS: `Origin` must be in `ADMIN_ORIGINS` (comma-separated env); OPTIONS
   preflight answered for those origins only.
2. Bearer token present → `auth.getClaims(token)` verifies the signature (JWKS)
   → `role === 'authenticated'` and `aal === 'aal2'` (else 403 `mfa_required`).
3. `auth.getUser(token)` succeeds (rejects ended sessions and banned users).
4. `rpc('admin_is_owner', { p_uid: sub })` is true (else 403 `forbidden`).

Responses: `200 { ok: true, data }` or `{ ok: false, error }` with status
400 `bad_request` · 401 `unauthorized` · 403 `forbidden`/`mfa_required` ·
404 `not_found` · 409 `conflict` · 500 `internal`. Never echo secrets,
passwords of other actions, or stack traces. Details as implemented:
- A missing or unlisted `Origin` is 403 `forbidden` with no CORS headers
  (preflight included). Non-POST is 400; a body over 8 KiB or not JSON is 400.
- Invalid, expired or garbage tokens and ended sessions are 401; a verified
  token that is not `role: authenticated` or whose `sub` is not a UUID is 401;
  `mfa_required` (403) only when `aal` is not `aal2`; Auth outages are 500.
- Account actions (`reset_password`, `handover`, `set_account_active`,
  `remove_factors`, `delete_account`) all refuse the owner's own account with
  403 `forbidden` (break-glass for the owner is the CLI). An unknown `userId` is 404.
- Every account action finds its account with a direct lookup,
  `admin_get_account(p_user)` (one jsonb object, or null without an account
  row), never by searching the list. PostgREST cuts any set-returning RPC at
  `max_rows` (100) and still answers 200, but never cuts a single value.
- Errors reach supabase-js as `FunctionsHttpError`; read
  `await error.context.json()` for `{ ok: false, error }`.

| action | params | data | notes |
|---|---|---|---|
| `status` | — | `admin_status()` JSON | heartbeat age, storage totals, settings |
| `list_accounts` | — | every row of `admin_list_accounts` | one array with every account: the function reads `admin_list_accounts(p_limit ≤ 100, p_offset)` page by page until a short page (order: owner first, then organisation name, then `user_id`; a row seen twice is kept once) and fails with 500 rather than return a cut list |
| `create_account` | `username, orgName, orgSlug, type, campus` | `{ userId, orgId, username, password }` | validate with `createAccountSchema` rules; `auth.admin.createUser({ email, password, email_confirm: true })`, then `admin_create_org_account`; if that fails, delete the auth user |
| `reset_password` | `userId` | `{ password }` | `admin_allow_password_change` → `updateUserById(userId, { password })` — ends all of that user's sessions |
| `handover` | `userId` | `{ password }` | deactivate → new password (grant, then Auth; ends sessions) → delete every MFA factor → reactivate |
| `set_account_active` | `userId, active` | `{}` | `admin_set_account_active`; `false` also bans (`ban_duration: '876000h'`), `true` unbans (`'none'`) |
| `update_org` | `orgId, name, slug, type, campus, active` | `{}` | `admin_update_org` |
| `remove_factors` | `userId` | `{ removed }` | `auth.admin.mfa.listFactors` + `deleteFactor` each |
| `delete_account` | `userId` | `{ removedFiles }` | refuse for the owner account; deactivate first (no upload can land after the listing) → `admin_org_objects` (every file name, one jsonb array) → Storage `remove` (≤1000 per call; any failed batch → 500, org and account kept deactivated so a retry can finish) → `admin_delete_org` → `auth.admin.deleteUser`. Only when `admin_get_account` finds no account row is an existing auth user (left by a failed create) just deleted |
| `delete_post` | `postId` | `{ removedFiles, failedFiles }` | `admin_delete_post` → Storage `remove` of returned paths. Unknown post 404. A Storage failure does not fail the request: `failedFiles` (a number, 0 when all went) counts the files still in the bucket, which stay public until the daily orphan sweep deletes them |
| `remove_post_image` | `postId` | `{ removedFiles, failedFiles }` | `admin_remove_post_image` → Storage `remove` (same failure rule and `failedFiles`) |

Generated passwords: 24 characters from `crypto.getRandomValues`, alphabet
without look-alikes (no 0/O/1/l/I), always containing a lowercase letter, an
uppercase letter and a digit (`password_requirements = lower_upper_letters_digits`).

## `maintenance` Edge Function

`POST /functions/v1/maintenance` with header `x-cron-secret: <CRON_SECRET>`
(compared in constant time on equal-length byte arrays). Anything else → 401
with no body detail. Steps (each logged as counts, never row contents):
1. `rpc('maint_heartbeat', { p_result })` — PostgREST write (keep-alive).
2. `rpc('maint_purge_expired', { p_limit: 100 })` → Storage `remove()` of the
   returned `poster_path`/`thumb_path` values (rows are already deleted). It
   returns one jsonb array of `{ kind: 'post'|'notice', id, poster_path,
   thumb_path }`, posts first.
3. Once a day (first run after 03:00 MYT, i.e. 19:00 UTC, or `?sweep=1`):
   `rpc('maint_orphans')` (one jsonb array of file names, oldest first) →
   Storage `remove()`; `rpc('maint_retention')`.
4. `rpc('maint_heartbeat', { p_result: { purged, files, orphans, retention, at } })`.

Both lists are single jsonb values, so PostgREST's `max_rows` (100) does not
cut them.

Response `200 { ok: true, purged: { posts, notices }, files, orphans, retention }`
(`orphans`/`retention` are null on hourly runs without the daily sweep). If a
later step fails, the response is `500 { ok: false, error: 'internal', purged,
files, orphans, retention, failed: [steps] }` so the cron run shows as errored;
step-2 deletions stay committed and are recorded in the final heartbeat. The
daily sweep runs when the heartbeat's `swept_at` is before the latest 19:00 UTC.
A `CRON_SECRET` that is unset or shorter than 32 characters makes every call
401 (logged as `maintenance_misconfigured`). So does the published example
value from `supabase/.env.example` anywhere but the local stack (`SUPABASE_URL`
is plain http to a local host such as `kong` or `127.0.0.1`; a hosted
project's is always `https://<ref>.supabase.co`, and `supabase secrets set`
cannot change `SUPABASE_*` names). Idempotent and bounded per run: ≤ 100
expired posts and ≤ 100 expired notices, so ≤ 200 poster files, plus, in the
daily sweep, ≤ 500 orphan files (`maint_orphans` default `p_limit`; at most
1000 when called with a larger one).

## Cron Worker (`workers/cron`)

`scheduled()` only (no `fetch` handler); `workers_dev: false`, `preview_urls: false`;
cron `7 * * * *` (UTC). Each run awaits, with `AbortSignal.timeout`:
1. `GET ${SUPABASE_URL}/rest/v1/site_settings?select=posting_enabled&limit=1`
   with `apikey: SUPABASE_PUBLISHABLE_KEY` — anonymous API traffic that keeps
   the free project from pausing.
2. `POST ${SUPABASE_URL}/functions/v1/maintenance` with `x-cron-secret: CRON_SECRET`.
A missing `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` stops the run before any
request. A missing `CRON_SECRET` does not stop step 1: the read still runs, step 2
is skipped and counts as failed (`maintenance: CRON_SECRET is not set`). If either
step fails, throw once both are done (the invocation shows as errored in Workers
Logs). Vars: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; secret: `CRON_SECRET`.

## Owner CLI (`scripts/account.ts`)

`pnpm account <command> [args]`, Node 26 (native TypeScript, no enums).
Environment: `SUPABASE_URL` (default `http://127.0.0.1:54321`) and
`SUPABASE_SECRET_KEY`. For a local URL the key may be omitted (read from
`supabase status -o env`). For production, pass the named `owner-cli` secret
key for one command only:

```
read -rs 'k?owner-cli key: '; SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account list; unset k
```

Commands: `list` · `create-owner <username>` · `create <username> --org "<name>" --type club|school [--campus main] [--slug <slug>]` ·
`reset-password <username>` · `handover <username>` · `deactivate <username>` · `activate <username>` ·
`remove-factors <username>` · `delete <username> --yes` · `owner-reset-mfa <username>` (break-glass) ·
`seed-local` (local URL only: `owner`, `demo-club` and `demo-school`; existing
ones are skipped, not reset). Passwords are printed once and never written to disk.

Break-glass meanings: `reset-password`, `deactivate` and `activate` also work on
the owner account; `handover`, `remove-factors` and `delete` refuse it;
`owner-reset-mfa` (owner only) sets a new password first, which ends every
session, then deletes every factor. Every new password goes through
`admin_allow_password_change` first, like the console's. A command finds its
account with `admin_get_account_by_username` (one jsonb object, or null), never
by searching the list; `list` reads `admin_list_accounts` page by page, so it
shows every account and the true total. `delete` without `--yes` only prints
what it would delete (exit 1). `SUPABASE_SECRET_KEY` must be an `sb_secret_`
key; a hosted URL must be https and an origin only; the target URL is printed
on stderr first. Exit codes: 0 done, 1 failed, 2 bad command line.

## Environment variables

| Where | Name | Notes |
|---|---|---|
| apps/web | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_IMAGE_MODE` (`proxy`/`direct`), `VITE_CONTACT_URL` | build-time, public |
| apps/web Pages Function | `SUPABASE_URL` | Pages project variable |
| apps/admin | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_PUBLIC_SITE_URL` (default `https://usmfomo.pages.dev`) | build-time, public |
| Edge Functions | `CRON_SECRET`, `ADMIN_ORIGINS` (+ injected `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`) | `supabase secrets set`, both names in one command with the local env files aside ([deploy.md](runbooks/deploy.md), step 7) |
| Cron Worker | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (vars), `CRON_SECRET` (secret) | `wrangler secret put` |
| Supabase Auth | Turnstile secret | dashboard only; local test secret in `supabase/.env` |
