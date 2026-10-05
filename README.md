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

Built locally, not yet deployed (2026-10-05): database security core (117 pgTAP
tests), public site + club studio + animated landing (`apps/web`), owner console
(`apps/admin`), two Edge Functions, the cron Worker and the owner CLI, CI/CD
workflows and runbooks. The landing page uses synthetic test clips until the
real media arrives. Next: accounts on Supabase, Cloudflare and GitHub, then the
first deploy (`docs/runbooks/deploy.md`).

## Stack

React + TypeScript + Vite single-page app and a plain three.js landing page on
**Cloudflare Pages** (`usmfomo.pages.dev`; owner console on
`usmfomo-admin.pages.dev`) · **Supabase Free** in Singapore (Postgres with RLS,
Auth with optional TOTP, Storage, two Edge Functions) · an hourly **Cloudflare
Worker** cron for cleanup and keep-alive · GitHub Actions · pnpm. Everything is
on free plans; nothing needs a card.

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
([`deploy.md`](docs/runbooks/deploy.md)), local development, onboarding a club,
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
