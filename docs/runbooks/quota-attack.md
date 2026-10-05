# Quota attack (someone floods the public API)

The publishable key ships to every browser and `https://<ref>.supabase.co` is
not behind Cloudflare, so anyone can send it requests. The database rules stop
writes and abuse, but a flood still burns the free quotas (egress, function
calls). Going over a Supabase quota gives one grace period, then **every** API
call answers 402 until the next cycle. This runbook keeps the site up and the
project under quota. It is an accepted residual risk (docs/PROJECT.md).

## 1. Check usage (weekly, and whenever something looks off)

- Supabase dashboard → **Usage**: egress (5 GB + 5 GB cached), Edge Function
  invocations (500k/month), database size (500 MB), storage (1 GB). Normal use is
  roughly 1–3 GB egress a month.
- Supabase → Logs (one day kept on Free): API and function logs, for the paths
  and user agents of the flood.
- Cloudflare → Workers & Pages → `usmfomo` → Metrics: the `/i/*` Function's
  requests (100k/day on Free).

A sudden jump in REST egress or function calls with no matching rise in real
traffic is the signal. Also take the Supabase "approaching limit" emails seriously.

## 2. Degrade on purpose: public reads off

Owner console → **Settings** → switch **public reads** off
(`public_reads_enabled = false`). Anonymous reads of posts and notices now return
nothing, so a flood of list requests costs almost no egress; the site shows a
degraded banner instead of events. Clubs can still sign in and manage posts.
Switch it back on when the flood stops (check Usage again an hour later).

Posting has its own switch (**posting**): turn it off only if writes are part of
the problem.

## 3. A flooded Edge Function: rename it

Rejected calls (401/403) still count as invocations. If `maintenance` or
`owner-admin` is being hammered, move it to a new, unguessable name and delete
the old one. Example for `maintenance`:

1. In a branch: rename the folder `supabase/functions/maintenance` to
   `supabase/functions/maintenance-<random>` (for example from
   `openssl rand -hex 4`), rename `[functions.maintenance]` in
   `supabase/config.toml` to match, update the URL in `workers/cron` and the
   function list in `.github/workflows/deploy.yml` and `scripts/check-config.py`.
2. Merge; the deploy ships the new function and the Worker that calls it.
3. Delete the old one: `pnpm supabase functions delete maintenance`.

For `owner-admin`, also update the function name the owner console invokes. The
new name is not secret forever (it is in the public repo), but it buys time.

## 4. Rotate keys

- **Publishable key** abused (it is public, but rotating breaks existing
  scripts): Supabase → API Keys → create a new publishable key → update the
  GitHub variable `VITE_SUPABASE_PUBLISHABLE_KEY` → redeploy (both apps and the
  cron Worker pick it up) → check the site works → delete the old key.
- **A secret key** may have leaked: create a new one, delete the old one, and
  redeploy the Edge Functions (they read `SUPABASE_SECRET_KEYS`); a new
  `owner-cli` key for the CLI.
- **`CRON_SECRET`**: new value in both places ([deploy.md](deploy.md), step 12).

## 5. Over quota already

- Supabase shows the grace period on the Usage page. Keep public reads off, let
  the counter reset at the next billing cycle, and note the date.
- A paused or restricted project can be restored from the dashboard; posts are
  temporary by design and the schema is in `supabase/migrations`.

## 6. Afterwards

Write a journal entry in `docs/PROJECT.md` (what was flooded, for how long, what
you switched). If floods repeat, the planned phase-2 option is a feed snapshot in
Workers KV written by the cron Worker, so public reads stop touching Supabase.
