# Local development

Everything runs on your Mac: the Supabase stack in Docker, Vite natively (or,
optionally, in a container), Deno for the Edge Functions. Commands run from the
repository root in zsh.

## Prerequisites

Docker Desktop, Node 26 (`.nvmrc`), pnpm, pre-commit and gitleaks, Deno 2,
Python 3.11+ (for `scripts/*.py`), and the GitHub CLI (repo access:
[github-account.md](github-account.md)).

```zsh
brew install pnpm pre-commit gitleaks deno gh
```

## Bootstrap (once per clone)

```zsh
pnpm install                                   # also installs the pinned Supabase CLI and wrangler
pre-commit install                             # gitleaks + large-file guard on every commit
cp supabase/.env.example supabase/.env         # Turnstile TEST secret + local function secrets
printf '[]' > supabase/signing_keys.json && pnpm supabase gen signing-key --algorithm ES256
pnpm supabase start                            # API 54321 · DB 54322 · Studio 54323 · Mailpit 54324
```

`supabase/signing_keys.json` holds a private key (ES256, like production): it is
git-ignored; never commit or share it.

App environment files (public local values only; both are git-ignored):

```zsh
{ pnpm -s supabase status -o env --override-name api.url=VITE_SUPABASE_URL \
    --override-name auth.publishable_key=VITE_SUPABASE_PUBLISHABLE_KEY | grep '^VITE_'
  echo 'VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA'   # Cloudflare's always-pass test key
} > apps/admin/.env.local
{ cat apps/admin/.env.local; echo 'VITE_IMAGE_MODE=direct'; echo 'VITE_CONTACT_URL='; } > apps/web/.env.local
```

Only the **publishable** key ever goes into these files, never an `sb_secret_` key.

Demo accounts (local only; passwords are printed once):

```zsh
pnpm account seed-local      # an owner and two demo clubs
```

## Daily loop

```zsh
pnpm supabase start          # if it is not running
pnpm dev                     # web http://127.0.0.1:5173 · owner console http://127.0.0.1:5174
pnpm supabase db reset       # re-apply migrations + seed (sample orgs/posts, test helpers)
pnpm supabase test db        # pgTAP security tests (must stay green)
pnpm supabase db advisors --local --type security --fail-on error
pnpm lint && pnpm typecheck && pnpm test
python3 scripts/check-config.py                       # config.toml security baseline
(cd supabase/functions && deno check ./*/index.ts && deno lint && deno fmt --check && deno test --no-prompt)
pnpm supabase stop           # when done: the stack listens on all interfaces
```

End-to-end checks of the functions, the cron Worker and the owner CLI against
the local stack: [functions-local.md](functions-local.md).

Production-like routing, headers and the `/i/*` Function:

```zsh
pnpm --filter web build && pnpm --filter web pages:dev   # wrangler pages dev on http://127.0.0.1:8788
```

The local CAPTCHA uses Cloudflare's test keys: the widget always passes, and
for curl any token string (for example `XXXX.DUMMY.TOKEN.XXXX`) is accepted.
No email is ever sent; anything that shows up in Mailpit (54324) is a bug.

### Run Deno only from `supabase/functions`

Deno 2.9, started anywhere else in the repo, finds no `deno.json`, picks up the
root `package.json`, **rewrites it** ("migrates" `pnpm-workspace.yaml` into a
`workspaces` field) and exits with an error. If that happened:

```zsh
git diff package.json          # a new "workspaces" line
git checkout -- package.json
```

CI runs Deno from `supabase/functions` with `DENO_NO_PACKAGE_JSON=1`.

## Ports

| Port | What |
|---|---|
| 54321 | Supabase API (REST, Auth, Storage, Functions) |
| 54322 | Postgres (`postgres`/`postgres`) |
| 54323 | Studio (no login) |
| 54324 | Mailpit |
| 5173 / 5174 | Vite: web / owner console |
| 4173 / 4174 | `vite preview`: web / owner console |
| 8788 | `wrangler pages dev` |
| 8083 | Edge runtime inspector |

## Campus Wi-Fi and other networks you do not control

The local Supabase stack binds **all interfaces** (`0.0.0.0`): anyone on the
same network can reach Studio (no login) and Postgres (`postgres`/`postgres`).
The macOS firewall's default setting does **not** block Docker's ports.

On campus Wi-Fi, in cafés or at hostels, either stop the stack
(`pnpm supabase stop`) or turn on System Settings → Network → Firewall →
Options → **Block all incoming connections**. To see what is exposed:

```zsh
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(5432[0-9]|8083) '    # "*:54321" means all interfaces
```

Vite (5173/5174) binds 127.0.0.1 only.

## FirstApp uses the same ports

FirstApp's Supabase stack uses 54321–54324 too, and its Vite may want 5173. Run
one project at a time:

```zsh
docker ps --format '{{.Names}}' | grep '^supabase_'   # the suffix is the project: _usmfomo or FirstApp's
(cd ../FirstApp && pnpm supabase stop)                # stop the other stack first
pnpm supabase start
```

"Port 5173 is already in use" from `pnpm dev` means another Vite (or the
compose `web` service) is running.

## Docker Compose (local tools)

`compose.yaml` has two profiles. Its project name is **`usmfomo-tools`** on
purpose: the Supabase CLI labels its containers
`com.docker.compose.project=usmfomo`, so a compose project called `usmfomo`
would treat the Supabase stack as its own and `down --remove-orphans` would
delete it. Never pass `-p usmfomo`.

### `tools`: ffmpeg for the landing media

The same image as the atlas pipeline (`mwader/static-ffmpeg:9.0.2`), with
`./media` mounted at `/media` (the working directory), `media/raw` read-only, no
network and no capabilities. Paths are relative to `media/`:

```zsh
docker compose run --rm ffmpeg -i raw/clips/club-night.mov -ss 2 -t 4 -an work/club-night-4s.mp4
docker compose run --rm --entrypoint /ffprobe ffmpeg -hide_banner raw/clips/club-night.mov
```

The full pipeline (`python3 apps/web/scripts/build-landing-atlas.py`) starts its
own ffmpeg containers; you do not need compose for it.

### `web` (optional): Vite in a Linux container

Running Vite natively (`pnpm dev`) is faster; use this to isolate the dev server.

```zsh
docker compose --profile web up --build      # needs apps/web/.env.local (above)
```

- Open <http://127.0.0.1:5173>. Inside the container Vite listens on
  `0.0.0.0`; Docker publishes it on `127.0.0.1` only.
- The first start installs Linux dependencies into named volumes (about a
  minute); later starts reuse them and pick up lockfile changes by themselves.
  Your macOS `node_modules` are never touched.
- Not at the same time as `pnpm dev` (both use port 5173).
- Stop with Ctrl-C (or `docker compose --profile web down`). Start from scratch:
  `docker compose --profile web down --volumes`.

## When something is off

| Symptom | Fix |
|---|---|
| `supabase start`: "failed to read signing keys" | create `supabase/signing_keys.json` (bootstrap) |
| Login says CAPTCHA failed | `supabase/.env` missing: `cp supabase/.env.example supabase/.env`, then `pnpm supabase stop && pnpm supabase start` |
| The app shows "Missing VITE_…" | create `apps/web/.env.local` / `apps/admin/.env.local` (bootstrap) |
| Ports busy | another stack or Vite is running (see FirstApp above) |
| Advisors or pgTAP fail after a migration change | `pnpm supabase db reset`, then rerun; CI runs the same commands |
