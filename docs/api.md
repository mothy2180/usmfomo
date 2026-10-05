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
  keyed by name; use `.default`) and the project URL from `SUPABASE_URL`. Never
  `SUPABASE_SERVICE_ROLE_KEY` (legacy, absent on new projects).
- New API keys go in the `apikey` header only. A user's access token goes in
  `Authorization: Bearer`. Never put an `sb_` key in `Authorization`.
- Logins are usernames: `username` → `username@usmfomo.pages.dev`
  (`usernameToEmail` in `packages/shared`). No email is ever sent.

## Database API used by the apps (PostgREST, RLS applies)

Public (anon, `publicDb` in `apps/web/src/lib/db.ts`):
- `rpc('search_posts', { p_type, p_q?, p_campus?, p_org?, p_limit≤50, p_offset })`
  → cards with `org_name, org_slug, thumb_path, total` (full count each page).
- `from('posts').select(...).eq('id', id).maybeSingle()` — event page; embed the
  org with `org:orgs(id,name,slug,type)`. Missing row = ended/removed/hidden.
- `from('notices').select('id,title,body,link_url,starts_at,ends_at,updated_at')`
- `from('orgs').select('id,name,slug,type,campus')` — active orgs only (RLS).

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
passwords of other actions, or stack traces.

| action | params | data | notes |
|---|---|---|---|
| `status` | — | `admin_status()` JSON | heartbeat age, storage totals, settings |
| `list_accounts` | — | rows of `admin_list_accounts()` | |
| `create_account` | `username, orgName, orgSlug, type, campus` | `{ userId, orgId, username, password }` | validate with `createAccountSchema` rules; `auth.admin.createUser({ email, password, email_confirm: true })`, then `admin_create_org_account`; if that fails, delete the auth user |
| `reset_password` | `userId` | `{ password }` | `updateUserById(userId, { password })` — ends all of that user's sessions |
| `handover` | `userId` | `{ password }` | deactivate → new password (ends sessions) → delete every MFA factor → reactivate |
| `set_account_active` | `userId, active` | `{}` | `admin_set_account_active`; `false` also bans (`ban_duration: '876000h'`), `true` unbans (`'none'`) |
| `update_org` | `orgId, name, slug, type, campus, active` | `{}` | `admin_update_org` |
| `remove_factors` | `userId` | `{ removed }` | `auth.admin.mfa.listFactors` + `deleteFactor` each |
| `delete_account` | `userId` | `{ removedFiles }` | refuse for the owner account; `admin_org_objects` → Storage `remove` (≤1000 per call) → `admin_delete_org` → `auth.admin.deleteUser` |
| `delete_post` | `postId` | `{ removedFiles }` | `admin_delete_post` → Storage `remove` of returned paths |
| `remove_post_image` | `postId` | `{ removedFiles }` | `admin_remove_post_image` → Storage `remove` |

Generated passwords: 24 characters from `crypto.getRandomValues`, alphabet
without look-alikes (no 0/O/1/l/I), always containing a lowercase letter, an
uppercase letter and a digit (`password_requirements = lower_upper_letters_digits`).

## `maintenance` Edge Function

`POST /functions/v1/maintenance` with header `x-cron-secret: <CRON_SECRET>`
(compared in constant time on equal-length byte arrays). Anything else → 401
with no body detail. Steps (each logged as counts, never row contents):
1. `rpc('maint_heartbeat', { p_result })` — PostgREST write (keep-alive).
2. `rpc('maint_purge_expired', { p_limit: 100 })` → Storage `remove()` of the
   returned `poster_path`/`thumb_path` values (rows are already deleted).
3. Once a day (first run after 03:00 MYT, i.e. 19:00 UTC, or `?sweep=1`):
   `rpc('maint_orphans')` → Storage `remove()`; `rpc('maint_retention')`.
4. `rpc('maint_heartbeat', { p_result: { purged, files, orphans, retention, at } })`.

Response `200 { ok: true, purged: { posts, notices }, files, orphans, retention }`.
Idempotent; bounded (≤100 rows, ≤1000 files per run); never throws away the
result of step 2 if step 3 fails.

## Cron Worker (`workers/cron`)

`scheduled()` only (no `fetch` handler); `workers_dev: false`, `preview_urls: false`;
cron `7 * * * *` (UTC). Each run awaits, with `AbortSignal.timeout`:
1. `GET ${SUPABASE_URL}/rest/v1/site_settings?select=posting_enabled&limit=1`
   with `apikey: SUPABASE_PUBLISHABLE_KEY` — anonymous API traffic that keeps
   the free project from pausing.
2. `POST ${SUPABASE_URL}/functions/v1/maintenance` with `x-cron-secret: CRON_SECRET`.
If either response is not ok, throw (the invocation shows as errored in
Workers Logs). Vars: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; secret: `CRON_SECRET`.

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
`seed-local` (local URL only: an owner and two demo clubs with printed passwords).
Passwords are printed once and never written to disk.

## Environment variables

| Where | Name | Notes |
|---|---|---|
| apps/web | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_IMAGE_MODE` (`proxy`/`direct`), `VITE_CONTACT_URL` | build-time, public |
| apps/web Pages Function | `SUPABASE_URL` | Pages project variable |
| apps/admin | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY` | build-time, public |
| Edge Functions | `CRON_SECRET`, `ADMIN_ORIGINS` (+ injected `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`) | `supabase secrets set` |
| Cron Worker | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (vars), `CRON_SECRET` (secret) | `wrangler secret put` |
| Supabase Auth | Turnstile secret | dashboard only; local test secret in `supabase/.env` |
