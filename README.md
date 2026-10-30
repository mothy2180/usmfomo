# usmfomo — what's on at USM

Students at Universiti Sains Malaysia have no single place to see what is
happening on campus, so most club and school events go unnoticed. **usmfomo**
lists them in one place: trusted club and school accounts post events, and
everyone can browse without signing up. Posts delete themselves when the event
is over.

> usmfomo is an independent, unofficial student project. It is not affiliated
> with, endorsed by, or operated by Universiti Sains Malaysia.

Everything about the project — decisions and why, architecture, security model,
roadmap and journal — is in [`docs/PROJECT.md`](docs/PROJECT.md). Architecture
decisions are in [`docs/adr/`](docs/adr/); operating procedures in
[`docs/runbooks/`](docs/runbooks/).

## Status

**Live since 2026-10-12.**

| | |
|---|---|
| Public site | https://usmfomo.pages.dev |
| Club & school studio | https://usmfomo.pages.dev/login |
| Owner console | https://usmfomo-admin.pages.dev |

What's in it:

- **Public site** (`apps/web`): a glass-shard three.js landing page with real
  campus clips, then a dashboard of Clubs and Schools events grouped by Happening
  now, Today, Tomorrow, This week and Later; search, campus filter, event and
  organiser pages, an "Add to Google Calendar" button, owner notices, and
  English, Bahasa Malaysia and Chinese.
- **Live updates** without Realtime: open pages poll one tiny row and reload
  only when something changed; the owner sets the interval (or turns it off).
- **Club studio**: trusted accounts post, edit, cancel and delete events with a
  poster (shrunk in the browser); daily and live-post limits are enforced by
  the database.
- **Owner console** (`apps/admin`): create, rename, reset and hand over
  accounts (typed or suggested passwords), moderate posts, notices, kill
  switches and the live-update interval.
- **Behind it**: about 200 pgTAP security tests, two Edge Functions, an hourly
  cron Worker that deletes ended events and keeps Supabase awake, and an owner
  CLI (`pnpm account`).
- Sign-in is username + password + CAPTCHA; there is no 2FA (decision in
  `docs/PROJECT.md`). Sign-ups are closed: only the owner creates accounts.

## Stack

React + TypeScript + Vite single-page app and a plain three.js landing page on
**Cloudflare Pages** (`usmfomo.pages.dev`; owner console on
`usmfomo-admin.pages.dev`) · **Supabase Free** in Singapore (Postgres with RLS,
Auth with CAPTCHA, Storage, two Edge Functions) · an hourly **Cloudflare
Worker** cron for cleanup and keep-alive · GitHub Actions · pnpm. Everything is
on free plans; nothing needs a card, and nothing runs on a laptop: the site
stays up when it is off.

## Deploying

Push to `main`. CI runs lint, types, unit and pgTAP tests and gitleaks; then the
Deploy workflow applies migrations, deploys the Edge Functions, both Pages
projects and the cron Worker. All deploy secrets live in GitHub, so any computer
with the repo and the `mothy2180` GitHub login can ship. Only auth settings
(`supabase config push`) and function secrets are changed by hand
([`deploy.md`](docs/runbooks/deploy.md)).

Which passwords and keys exist, where each is kept and what to do if one is
lost: [`docs/runbooks/secrets.md`](docs/runbooks/secrets.md).

## Local development

Docker Desktop, Node 26, pre-commit and gitleaks are prerequisites.

Bootstrap once, from the repository root:

```bash
brew install pnpm
pnpm install                                   # also installs the pinned Supabase CLI and wrangler
pre-commit install                             # gitleaks + large-file guard on every commit
cp supabase/.env.example supabase/.env         # Turnstile TEST secret for the local CAPTCHA
printf '[]' > supabase/signing_keys.json && pnpm supabase gen signing-key --algorithm ES256
pnpm supabase start                            # the Docker stack: API 54321 · DB 54322 · Studio 54323 · Mailpit 54324
```

Daily loop:

```bash
pnpm supabase db reset      # re-apply migrations + seed (sample orgs/posts, test helpers)
pnpm account seed-local     # local owner + demo-club + demo-school (passwords printed once)
pnpm dev                    # web http://127.0.0.1:5173 · owner console http://127.0.0.1:5174
pnpm check                  # lint, typecheck and unit tests for every package + the CLI
pnpm supabase test db       # pgTAP security tests (must stay green)
pnpm e2e:functions          # Edge Functions end to end against the local stack
pnpm supabase db advisors --local --type security --fail-on error
pnpm supabase stop          # when done — the local stack listens on all interfaces
```

Copy `apps/web/.env.example` and `apps/admin/.env.example` to `.env.local` first
(local values: `pnpm supabase status -o env`). Landing media and the optional
containerised dev server: `docker compose --profile tools run --rm ffmpeg ...`
and `docker compose --profile web up` (see `docs/runbooks/local-dev.md`).
Run Deno from `supabase/functions` (or set `DENO_NO_PACKAGE_JSON=1`): from the
repo root Deno rewrites the root `package.json`.

Operations: [`docs/runbooks/`](docs/runbooks/) — first deploy
([`deploy.md`](docs/runbooks/deploy.md)), secrets, local development, onboarding a club,
committee handover, forgotten passwords, owner lockout, account takeover, quota
attack, and the USM permission letter.

On networks you don't control (campus Wi-Fi), stop the stack or turn on
"Block all incoming connections" in the macOS firewall: the local Studio has no
login and the macOS firewall's default does not block Docker. FirstApp uses the
same ports, so run one Supabase stack at a time.

## Repository rules

- Public repo under **github.com/mothy2180**. Commits use the repo-local
  noreply identity (see `docs/runbooks/github-account.md`); secrets are never
  committed — gitleaks runs in pre-commit and CI over the full history.
- Every table's GRANTs and RLS policies live in the migration that creates it.
  Never `GRANT ALL ... TO anon, authenticated`.
- `supabase config push` is run by hand after `supabase config diff`, never from CI.

## Licence

AGPL-3.0-only — see [`LICENSE`](LICENSE). Landing-page media is © its owners,
used with permission, and is not covered by the AGPL — see
[`apps/web/src/landing3d/media/NOTICE.md`](apps/web/src/landing3d/media/NOTICE.md).
