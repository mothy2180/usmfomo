# Secrets and passwords: where each one lives

Every password, key and token usmfomo uses, where its **value** is kept, and
what to do if it is lost. This file holds names only, never values: the values
live in your password manager or only in the service that uses them.

## In your password manager (you need these yourself)

Make one entry per row, with the name in the first column.

| Entry name | What it is | Used for | If lost |
|---|---|---|---|
| usmfomo owner login | username `tim-owner` and its password | signing in to the owner console, https://usmfomo-admin.pages.dev | [owner-lockout.md](owner-lockout.md) (`pnpm account reset-password tim-owner` with the `owner_cli` key) |
| usmfomo owner_cli key | Supabase secret key named `owner_cli` (`sb_secret_…`) | `pnpm account …` on your laptop (create, rename, reset, break-glass) | Supabase → Project Settings → API Keys: delete it and create a new `owner_cli` |
| usmfomo database password | Postgres password of project `gdtjshceeguaveiixjmm` | also the GitHub secret `SUPABASE_DB_PASSWORD` (CI migrations) | Supabase → Database → Reset database password, then `gh secret set SUPABASE_DB_PASSWORD --env production` |
| usmfomo CRON_SECRET | 64 hex characters | Supabase function secret and the `usmfomo-cron` Worker secret (must match) | [deploy.md](deploy.md), "Rotating `CRON_SECRET`" |
| GitHub `mothy2180` | password + 2FA recovery codes | the repository and every deploy | GitHub account recovery |
| Supabase account | password + 2FA recovery codes | dashboard, `pnpm supabase login` | Supabase account recovery |
| Cloudflare account | password + 2FA recovery codes | dashboard, `pnpm wrangler login` | Cloudflare account recovery |
| Google account of the contact channel | password + 2FA recovery codes | Search Console, Feedback form | Google account recovery |

## Kept only inside a service (never copied anywhere else)

These were pasted once, straight into the service. If one is lost or leaks, make
a new one; there is nothing to look up.

| Name | Lives in | Renew when |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | GitHub → environment `production` → secret | CI fails with an auth error, or it leaks ([deploy.md](deploy.md) step 3) |
| `CLOUDFLARE_API_TOKEN` | GitHub → environment `production` → secret | **expires October 2027**, or it leaks ([deploy.md](deploy.md) step 8) |
| Turnstile secret key | Supabase → Authentication → Attack Protection | it leaks (Cloudflare → Turnstile → Rotate secret, then paste into Supabase) |
| Supabase secret key `default` | Supabase, given to the Edge Functions automatically | it leaks ([quota-attack.md](quota-attack.md), section 4) |

## Club and school passwords

You don't keep these. The owner console shows a new password once (or you type
one); you give it 1:1 to the verified contact, who keeps it. A club that forgot
it gets a new one: [forgot-password.md](forgot-password.md).

## Not secret (fine in files and on GitHub)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`),
`VITE_TURNSTILE_SITE_KEY`, `VITE_CONTACT_URL`, `SUPABASE_PROJECT_ID`,
`CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_POOLER_HOST`, `ADMIN_ORIGINS`. They end up in
every browser or in public settings anyway. The local test values in
`supabase/.env.example` and `apps/*/.env.example` are public test keys.
