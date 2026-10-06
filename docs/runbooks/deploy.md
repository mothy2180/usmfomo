# Deploy: first-time production setup, the pipeline, and smoke tests

How usmfomo gets to production, step by step, and how to check it afterwards.
Do the steps in order: some depend on earlier ones (the two Pages names must be
yours **before** anything points at them; the Turnstile secret must be in the
Supabase dashboard **before** any `config push`; the Pages variable must exist
**before** the first deploy). Budget about two hours for the first time.

Everything is on free plans; nothing needs a card. Commands run from the
repository root on your Mac (zsh). `<ref>` is the Supabase project ref, for
example `abcdefghijklmnopqrst`.

**Never put a secret in a file, a chat, a screenshot or a commit.** Read it with
`read -rs`, use it for one command, then `unset` it. Secrets live only in your
password manager and in the service that needs them.

## How a deploy works (after setup)

1. You push to `main`. **CI** (`.github/workflows/ci.yml`) runs: lint, typecheck,
   tests, build, pgTAP, advisors, the config guard and gitleaks.
2. When CI succeeds on `main`, **Deploy** (`.github/workflows/deploy.yml`) runs:
   - `gate` picks that exact commit (a manual run from the Actions tab deploys
     `main`'s HEAD, and only if CI passed for it);
   - `build` has **no secrets**: it builds both apps with the production public
     values and uploads artifacts;
   - `deploy` (environment `production`) downloads the artifacts and installs
     the Supabase CLI and wrangler exactly as `pnpm-lock.yaml` pins them, in a
     step that has no secrets. Then it runs `supabase db push`,
     `supabase functions deploy maintenance owner-admin`, `wrangler pages deploy`
     for `usmfomo` and `usmfomo-admin`, and `wrangler deploy` for the cron
     Worker; each token reaches only the steps that use it. No other install,
     no cache.
3. Supabase steps run only once the variable `SUPABASE_PROJECT_ID` exists and
   Cloudflare steps only once `CLOUDFLARE_ACCOUNT_ID` exists, so the pipeline can
   grow by phase (Pages first, then the database at go-live). The run summary
   says what was skipped. Until the repository variable `VITE_SUPABASE_URL`
   exists (step 10), every Deploy run is skipped as "not configured yet".

`supabase config push` is **never** run by CI. Project settings (auth, API,
storage) change only by hand, after `config diff`: see step 6 and
[Changing project settings later](#changing-project-settings-later).

## Before you start

- GitHub: the repo exists under **mothy2180** ([github-account.md](github-account.md)).
- MFA on every account you use below: GitHub, Supabase, Cloudflare, and the
  Google account of the usmfomo contact channel. Save the recovery codes in your
  password manager.
- Two authenticator devices for the owner console (for example your phone and a
  tablet, or a hardware-backed desktop authenticator).

## Keep local values out of production

The Supabase CLI fills every `env(...)` in `supabase/config.toml` (the CAPTCHA
secret, `CRON_SECRET`, `ADMIN_ORIGINS`) from your shell and from these files,
both in `supabase/` and in the repository root: `.env`, `.env.local`,
`.env.development` and `.env.development.local`. It also takes `SUPABASE_*`
variables as overrides of settings. On a laptop these files hold the public
local test values (`supabase/.env` is a copy of `supabase/.env.example`), and
CLI 2.119.0 sends them to production on its own: `secrets set` of one name also
uploads every other `[edge_runtime.secrets]` value it can fill in, for example
the local `CRON_SECRET` or a localhost `ADMIN_ORIGINS`.

So every command that writes to production (`config push`, `db push`,
`functions deploy`, `secrets set`) runs between these two. Paste them once into
the terminal you use:

```zsh
hide_local_env() {      # (N): only the files that exist
  local f
  for f in {supabase/,}.env{,.local,.development,.development.local}(N); do mv "$f" "$f.aside"; done
  unset -m 'SUPABASE_*'; unset TURNSTILE_SECRET CRON_SECRET ADMIN_ORIGINS
}
restore_local_env() {
  local f
  for f in {supabase/,}.env{,.local,.development,.development.local}.aside(N); do mv "$f" "${f%.aside}"; done
}
```

The `.aside` files are git-ignored like the originals. Run `restore_local_env`
when you are done, or the local stack loses its test values.

## 0. Cloudflare account and the two Pages names (first)

Everything below assumes `usmfomo.pages.dev` and `usmfomo-admin.pages.dev`: the
Turnstile hostnames (step 4), `site_url` (step 6) and `ADMIN_ORIGINS` (step 7).
Claim both names before anything points at them.

1. Create a free Cloudflare account (no card), turn on MFA.
2. On your laptop (browser login for these one-off commands):
   ```zsh
   pnpm wrangler login
   pnpm wrangler whoami                       # shows the Account ID (GitHub variable, step 10)
   pnpm wrangler pages project create usmfomo --production-branch main
   pnpm wrangler pages project create usmfomo-admin --production-branch main
   ```
   If a name is taken, stop here: `site_url`, the Turnstile hostnames,
   `ADMIN_ORIGINS` and the docs all assume these two names.

## 1. Supabase organisation and project

1. <https://supabase.com/dashboard> → **New organization**: name `usmfomo`,
   plan **Free**. A separate organisation keeps the CI token's reach (step 3) to
   this project only.
2. **New project** in that organisation:
   - Name `usmfomo`; Region **Southeast Asia (Singapore)**, `ap-southeast-1`.
   - Database password: generate a long one and save it as "usmfomo database
     password". CI needs it (GitHub secret `SUPABASE_DB_PASSWORD`).
   - Security options: keep the Data API on, and **untick "Automatically expose
     new tables"** (and functions, if offered). Every table's GRANTs live in its
     migration; `api.auto_expose_new_tables = false` in `config.toml` says the same.
   - Postgres version: **17** (the default for new projects). The migrations
     use Postgres 16+ functions, and `config.toml` says `major_version = 17`;
     check Project Settings → Infrastructure after the project is created.
3. Note the **project ref** (Project Settings → General, or the `<ref>` in
   `https://<ref>.supabase.co`).

## 2. API keys: publishable, and a named secret key `owner-cli`

Project Settings → **API Keys**:

- The **publishable** key (`sb_publishable_…`) is public. It goes into the GitHub
  variable `VITE_SUPABASE_PUBLISHABLE_KEY` (step 10) and from there into both apps
  and the cron Worker.
- A secret key named `default` exists. Edge Functions receive it automatically
  (`SUPABASE_SECRET_KEYS`); you never copy it anywhere. Keep that name: to
  replace the key, follow [quota-attack.md](quota-attack.md), section 4.
- **Create a new secret key** named `owner-cli`. It is only for `pnpm account`
  on your laptop (owner bootstrap and break-glass, [owner-lockout.md](owner-lockout.md)).
  Copy it once into your password manager. Never into a file, `.env`, shell
  profile or GitHub.
- Do not use legacy `anon`/`service_role` keys; usmfomo never reads them.

## 3. Access token for CI (scoped)

Account (your avatar) → **Access Tokens** → generate a token:

- Name `usmfomo-github-deploy`; scope it to the **usmfomo** organisation/project
  only, with the narrowest permissions that still allow database migrations and
  Edge Function deploys; expiry about one year. Put the expiry date in your calendar.
- If your dashboard offers no scoping, the token reaches every project of your
  account. Step 1's separate organisation then matters even more: keep nothing
  else there, and treat the token like a password.
- It goes only into the GitHub environment secret `SUPABASE_ACCESS_TOKEN` (step 10).
  On your laptop you use your own `supabase login`, not this token.

## 4. The Turnstile widget

1. Cloudflare dashboard (the account from step 0) → **Turnstile** → **Add widget**:
   - Name `usmfomo`; hostnames **`usmfomo.pages.dev`** and **`usmfomo-admin.pages.dev`**;
   - Widget mode **Managed**; pre-clearance off.
2. Note both keys:
   - **Site key**: public; GitHub variable `VITE_TURNSTILE_SITE_KEY` (step 10).
   - **Secret key**: only for the Supabase dashboard (next step).

Local development keeps Cloudflare's public **test** keys (`supabase/.env.example`,
`apps/*/.env.example`). Never use the production keys locally, and never the test
keys in production (the deploy build refuses a test site key).

## 5. The production Turnstile secret goes into Supabase first

Supabase dashboard → **Authentication** → **Attack Protection** (Bot and Abuse
Protection) → enable CAPTCHA, provider **Cloudflare Turnstile**, paste the
**secret key** from step 4, save.

Do this **before any `config push`**. `config.toml` sets
`[auth.captcha] secret = "env(TURNSTILE_SECRET)"`, and on your laptop that
variable normally holds the always-pass **test** secret from `supabase/.env`. A
push with the test secret would make production accept any CAPTCHA token. With
the local files aside (step 6), `env(TURNSTILE_SECRET)` stays unresolved and
`config push` leaves this dashboard value as it is.

## 6. Link the project; diff and push the config by hand

```zsh
pnpm supabase login                      # your own login (browser), stored by the CLI
pnpm supabase link --project-ref <ref>   # records the project and its IPv4 pooler (no password needed)
python3 scripts/check-config.py          # the committed config keeps the baseline
```

Push the settings with no local value in reach. Do **not** put the production
Turnstile secret in your shell: step 5 already put it in the dashboard, and
an unresolved `env(TURNSTILE_SECRET)` is never sent.

```zsh
hide_local_env                                # see "Keep local values out of production"
pnpm supabase config diff                     # read EVERY line before pushing
pnpm supabase config push                     # answer y only for changes you reviewed
restore_local_env
pnpm supabase config diff                     # expect no differences now
```

On a new project the first diff shows the baseline replacing the defaults, for
example: `max_rows` 100, `jwt_expiry` 1800, `enable_signup` false,
`minimum_password_length` 12 with lower/upper/digits, the https `site_url`, TOTP
on, CAPTCHA on (Turnstile), the email notifications off, storage file size 2 MiB.

Secrets are the exception: the API masks them, so `config diff` only lists them
as "not compared" and can never show a wrong CAPTCHA secret. Rely on
`hide_local_env` instead, answer **n** if `config push` ever offers to change
the CAPTCHA secret, `CRON_SECRET` or `ADMIN_ORIGINS`, and after every push run
the CAPTCHA probe from step 14: it must still answer `400 captcha_failed`.

## 7. Database, Edge Functions and the function secrets (first time by hand)

CI does the first two on every deploy; doing them once by hand shows you they
work. Then the two function secrets, **both in one command** with explicit
values: CLI 2.119.0 fills any name you leave out from the local files, and
`hide_local_env` makes sure there is nothing to fill it from.

First generate `CRON_SECRET` in your password manager (64 random letters and
digits) and save it as "usmfomo CRON_SECRET": step 12 and every rotation read
it from there.

```zsh
hide_local_env
pnpm supabase db push --skip-vault                     # supabase/migrations only (the seed never runs)
pnpm supabase functions deploy maintenance owner-admin # verify_jwt = false comes from config.toml
read -rs 'CRON?CRON_SECRET (password manager): '; echo
pnpm supabase secrets set CRON_SECRET="$CRON" ADMIN_ORIGINS=https://usmfomo-admin.pages.dev
pnpm supabase secrets list                             # names and digests (SHA-256 of each value)
printf %s "$CRON" | shasum -a 256                      # must equal the CRON_SECRET digest
printf %s https://usmfomo-admin.pages.dev | shasum -a 256   # must equal the ADMIN_ORIGINS digest
unset CRON; restore_local_env
```

If a digest differs, set both values again (still between `hide_local_env` and
`restore_local_env`). The cron Worker gets the same `CRON_SECRET` in step 12,
once the first deploy has created it.

## 8. Cloudflare: API token for CI

Dashboard → My Profile → **API Tokens** → Create Token → **Custom token**:

- Name `usmfomo-github-deploy`;
- Permissions: **Account · Cloudflare Pages · Edit** and **Account · Workers
  Scripts · Edit**; Account resources: include only your account;
- No IP filter (GitHub runners change), expiry about one year (calendar).
- It goes only into the GitHub secret `CLOUDFLARE_API_TOKEN` (step 10). If a
  deploy fails with an authentication error, add only the permission it names.

## 9. Pages project variable for the image proxy

The `/i/*` Pages Function reads `SUPABASE_URL` from the Pages project. Dashboard →
Workers & Pages → **usmfomo** → Settings → **Variables and Secrets** →
Production → add **plain text** `SUPABASE_URL` = `https://<ref>.supabase.co` → Save.

Variables apply to **new** deployments only, so set it before the first deploy
(or redeploy afterwards). The owner console project needs no variables.

## 10. GitHub: the `production` environment, secrets and variables

Repository → Settings → **Environments** → New environment `production`:

- Deployment branches and tags → **Selected branches and tags** → add `main`.
- Optional: Required reviewers → yourself (every deploy then waits for your click).

| Where | Name | Value |
|---|---|---|
| Environment `production` · secret | `SUPABASE_ACCESS_TOKEN` | token from step 3 |
| Environment `production` · secret | `SUPABASE_DB_PASSWORD` | database password from step 1 |
| Environment `production` · secret | `CLOUDFLARE_API_TOKEN` | token from step 8 |
| Environment `production` · variable | `SUPABASE_PROJECT_ID` | `<ref>` |
| Environment `production` · variable | `CLOUDFLARE_ACCOUNT_ID` | Account ID from step 0 |
| Repository · variable | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| Repository · variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (step 2) |
| Repository · variable | `VITE_TURNSTILE_SITE_KEY` | site key (step 4) |
| Repository · variable | `VITE_CONTACT_URL` | the usmfomo contact channel URL (may stay empty) |

The four `VITE_*` values are **repository** variables because the `build` job has
deliberately no environment (so it can never see a secret). They are public
anyway: they end up in every browser. Never put a secret key in a variable; the
build refuses anything but `sb_publishable_…`.

With the GitHub CLI (it asks for each secret with hidden input):

```zsh
export GH_TOKEN="$(gh auth token --user mothy2180)"; R=mothy2180/usmfomo
gh api -X PUT "repos/$R/environments/production" \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST "repos/$R/environments/production/deployment-branch-policies" -f name=main -f type=branch
gh secret set SUPABASE_ACCESS_TOKEN --env production --repo "$R"
gh secret set SUPABASE_DB_PASSWORD  --env production --repo "$R"
gh secret set CLOUDFLARE_API_TOKEN  --env production --repo "$R"
gh variable set SUPABASE_PROJECT_ID   --env production --repo "$R" --body '<ref>'
gh variable set CLOUDFLARE_ACCOUNT_ID --env production --repo "$R" --body '<account id>'
gh variable set VITE_SUPABASE_URL             --repo "$R" --body 'https://<ref>.supabase.co'
gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --repo "$R" --body 'sb_publishable_…'
gh variable set VITE_TURNSTILE_SITE_KEY       --repo "$R" --body '<site key>'
gh variable set VITE_CONTACT_URL              --repo "$R" --body '<contact URL>'
unset GH_TOKEN
```

Repository → Settings → **Actions** → General:

- Tick **Require actions to be pinned to a full-length commit SHA**.
- If you restrict which actions may run, allow GitHub's own plus
  `pnpm/action-setup` and `denoland/setup-deno`. The deploy job runs the
  Supabase CLI and wrangler from the lockfile, not through their actions.
- Workflow permissions: **Read repository contents**; do not let Actions create
  or approve pull requests.

## 11. First deploy

```zsh
export GH_TOKEN="$(gh auth token --user mothy2180)"
gh workflow run deploy.yml --repo mothy2180/usmfomo --ref main   # or just push to main
gh run watch --repo mothy2180/usmfomo
unset GH_TOKEN
```

A manual run is refused unless CI passed for `main`'s HEAD. Expect `gate` →
`build` → `deploy`; the summary lists Supabase and Cloudflare as deployed. The
first `wrangler deploy` creates the Worker `usmfomo-cron` (no URL: `workers_dev`
and `preview_urls` are off).

## 12. Connect the cron Worker: the same `CRON_SECRET`

The value from step 7 must also be in the Worker (sent as `x-cron-secret`;
`maintenance` compares it with its own). Now that the Worker exists:

```zsh
read -rs 'CRON?CRON_SECRET (password manager): '; echo
printf '%s' "$CRON" | pnpm wrangler secret put CRON_SECRET --config workers/cron/wrangler.jsonc
unset CRON
```

Until this step, every hourly run still makes its keep-alive read (the free
project does not pause), then fails with `maintenance: CRON_SECRET is not set`:
the invocation shows as errored in Workers Logs. If the two values differ,
`maintenance` answers 401 and the run fails with `maintenance: HTTP 401`.

### Rotating `CRON_SECRET`

Always both places, and in Supabase always together with `ADMIN_ORIGINS`. Put
a new value in the password manager entry first, then:

```zsh
hide_local_env
read -rs 'CRON?New CRON_SECRET: '; echo
pnpm supabase secrets set CRON_SECRET="$CRON" ADMIN_ORIGINS=https://usmfomo-admin.pages.dev
printf '%s' "$CRON" | pnpm wrangler secret put CRON_SECRET --config workers/cron/wrangler.jsonc
pnpm supabase secrets list; printf %s "$CRON" | shasum -a 256   # the digests must match
unset CRON; restore_local_env
```

The next run at :07 must be ok (`pnpm wrangler tail usmfomo-cron`).

## 13. Owner account

```zsh
read -rs 'k?owner-cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account create-owner <username>; unset k
```

The password is printed once: put it in your password manager. Sign in at
<https://usmfomo-admin.pages.dev> and **enrol two TOTP devices straight away**;
the console allows nothing else until you have.

## 14. Production smoke tests

Public values only; set them in the shell first:

```zsh
SITE=https://usmfomo.pages.dev; ADMIN=https://usmfomo-admin.pages.dev
API=https://<ref>.supabase.co; PUB='sb_publishable_…'
```

| Check | Command | Expect |
|---|---|---|
| Landing at `/`, CSP enforced | `curl -sI $SITE/` | `200`, `text/html`, `content-security-policy` with `connect-src 'self' https://<ref>.supabase.co`, HSTS; no 3xx |
| SPA fallback | `curl -s -o /dev/null -w '%{http_code}\n' $SITE/e/x` | `200` (app shell; the page says the event ended or was removed) |
| Assets immutable | `curl -sI $SITE/assets/<a .js file from the page>` | `200`, JavaScript, `cache-control: public, max-age=31536000, immutable` |
| Image-proxy Function | `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $SITE/i/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000.webp` | `404 text/plain…`: a valid poster path that does not exist, so the Function asked Supabase. `500` means the Pages variable `SUPABASE_URL` is missing (step 9), `200 text/html` that the Function is missing |
| Console headers | `curl -sI $ADMIN/` | `200`, `x-robots-tag: noindex, nofollow`, `cache-control: no-store`, CSP |
| CAPTCHA enforced (production secret) | see below: a made-up token | `400 captcha_failed` |
| **Signups not allowed** | see below | `422 signup_disabled`, "Signups not allowed for this instance" |
| No anonymous writes | `curl -s -X POST $API/rest/v1/posts -H "apikey: $PUB" -H 'Content-Type: application/json' -d '{"title":"probe"}'` | `401`, code `42501` |
| Maintenance locked | `curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/functions/v1/maintenance -H "apikey: $PUB"` | `401` |
| Owner API locked | `curl -s -X POST $API/functions/v1/owner-admin -H "apikey: $PUB" -H "Origin: $ADMIN" -H 'Content-Type: application/json' -d '{"action":"status"}'` | `401 {"ok":false,"error":"unauthorized"}`; without the Origin header `403` |
| Config in sync | `pnpm supabase config diff` | no differences |
| Cron runs | `pnpm wrangler tail usmfomo-cron` at :07 past the hour | one scheduled event, outcome ok; the console shows "last maintenance N min ago" |

CAPTCHA and sign-ups, step by step. First a made-up token: the production
secret rejects it before Auth looks at anything else (this is the CAPTCHA probe
that step 6 asks for after every `config push`):

```zsh
curl -s -X POST "$API/auth/v1/signup" -H "apikey: $PUB" -H 'Content-Type: application/json' \
  -d '{"email":"probe@usmfomo.pages.dev","password":"Probe-Password-123456","gotrue_meta_security":{"captcha_token":"XXXX.DUMMY.TOKEN.XXXX"}}'
```

Expect `400` with `captcha_failed`. `422 signup_disabled` here means the
always-pass **test** secret reached production (it accepts any token): paste
the production secret into the dashboard again (step 5) at once, then find out
how the local value got there.

To reach the sign-up switch itself you need one real token: open
`$SITE/login`, wait for the Turnstile tick, run `turnstile.getResponse()` in the
browser console and copy the result (single use, valid five minutes). Then:

```zsh
read -r 'T?Turnstile token: '
curl -s -X POST "$API/auth/v1/signup" -H "apikey: $PUB" -H 'Content-Type: application/json' \
  -d "{\"email\":\"probe@usmfomo.pages.dev\",\"password\":\"Probe-Password-123456\",\"gotrue_meta_security\":{\"captcha_token\":\"$T\"}}"
unset T
```

Locally the made-up token passes the test secret, so there the first request
already answers `422 signup_disabled`: expected on your laptop, never in
production.

After the first club posts a poster, open the event: the image URL is
`/i/<org>/<file>.webp`, it loads, and a second request shows `cf-cache-status: HIT`.

## 15. Reminders

- Calendar: expiry of the Supabase and Cloudflare CI tokens (renew, then update
  the GitHub secrets); `Expires` in `apps/web/public/.well-known/security.txt`.
- Weekly: Supabase **Usage** page ([quota-attack.md](quota-attack.md)).
- A Supabase "project will be paused" email means the cron Worker stopped: check
  `pnpm wrangler tail usmfomo-cron` and the heartbeat in the console.

## Changing project settings later

1. Edit `supabase/config.toml` in a pull request. CI's guard
   (`scripts/check-config.py`) fails if the security baseline drifts, and also
   on any `[remotes.*]` table or a `supabase/config.json`: the CLI would push
   those instead of the checked values.
2. After merging, on your laptop: step 6 again (`hide_local_env`,
   `config diff`, `config push`, `restore_local_env`, then the CAPTCHA probe).
   Never put the production Turnstile secret in your shell.
3. Never add `config push` to a workflow.

## Rolling back

- **Pages** (site or console): dashboard → Workers & Pages → project →
  Deployments → an earlier production deployment → **Rollback**. Instant.
- **Cron Worker**: `pnpm wrangler rollback --config workers/cron/wrangler.jsonc`.
- **Database**: migrations only go forward. Fix with a new migration; re-running
  an old Deploy run fails at `db push` once newer migrations are applied.
- **Edge Functions**: revert the code on `main`; the next deploy ships it.

## Where things live

| Thing | Lives in |
|---|---|
| Database password, `owner-cli` key, owner password, CI tokens | your password manager (+ GitHub secrets for CI) |
| Production Turnstile secret | Supabase dashboard only |
| `CRON_SECRET` | Supabase secrets + Worker secret + your password manager (nowhere else) |
| `ADMIN_ORIGINS` | Supabase secrets |
| `SUPABASE_URL` for `/i/*` | Pages project variable (usmfomo) |
| Public build values (`VITE_*`) | GitHub repository variables |
| Project ref, Cloudflare account ID | GitHub environment variables |
