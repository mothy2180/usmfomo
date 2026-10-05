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

Phase P0/P1 (2026-10-05): repository, toolchain and the database security core
(migrations + 117 pgTAP tests). No web app yet.

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
pnpm supabase test db       # pgTAP security tests (must stay green)
pnpm supabase db advisors --local --type security --fail-on error
pnpm supabase stop          # when done — the local stack listens on all interfaces
```

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

AGPL-3.0-only — see [`LICENSE`](LICENSE). Landing-page media (once added) is ©
its owners, used with permission, and is not covered by the AGPL.
