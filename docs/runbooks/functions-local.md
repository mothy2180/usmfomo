# Edge Functions, cron Worker and owner CLI: local checks

How to test `supabase/functions/{maintenance,owner-admin}`, `workers/cron` and
`scripts/account.ts` (contracts in [`docs/api.md`](../api.md)).

## What runs where locally

- `pnpm supabase start` serves both functions at
  `http://127.0.0.1:54321/functions/v1/<name>` (`verify_jwt = false`; both
  authorise in code). `CRON_SECRET` and `ADMIN_ORIGINS` come from
  `supabase/.env`; `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` are injected.
- The runtime uses the `per_worker` policy, so a warm worker keeps the old code
  after an edit. New code is picked up when the worker recycles (a few minutes).
  To check a change at once, run the Deno tests, or restart the stack if
  nobody else is using it.
- `CRON_SECRET` must be at least 32 characters, or maintenance refuses every
  call (401) and logs `maintenance_misconfigured`.

## Checks that need no stack

```bash
cd supabase/functions
deno task check && deno lint && deno fmt --check && deno task test
cd ../..
pnpm --filter cron typecheck && pnpm --filter cron test
node --test scripts/lib/*.test.ts
```

There is no root tsconfig for `scripts/` yet. To type-check the CLI with the
same strict, erasable-only rules as `packages/shared`, run:

```bash
packages/shared/node_modules/.bin/tsc --noEmit --strict --target es2024 --lib es2024 \
  --module nodenext --moduleResolution nodenext --allowImportingTsExtensions \
  --erasableSyntaxOnly --verbatimModuleSyntax --noUncheckedIndexedAccess \
  --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --skipLibCheck \
  --types node --typeRoots apps/web/node_modules/@types \
  scripts/account.ts scripts/lib/*.ts scripts/lib/e2e/*.ts
```

## End to end against the local stack

```bash
node scripts/lib/e2e/functions-e2e.ts      # ends with "ALL PASSED"
```

The script does the following:

1. Maintenance: no secret, a wrong secret or GET give 401. The right secret
   gives 200, and the heartbeat moves.
2. It creates a throwaway owner (`zz-e2e-<run>-owner`) with the CLI and signs
   in with the CAPTCHA test token.
3. It checks that aal1 gets 403 `mfa_required`, then enrols TOTP (it computes
   RFC 6238 codes itself) to get an aal2 token.
4. It runs every owner-admin action, including the conflict, validation and
   unknown-id cases.
5. It checks that a club account is refused: `mfa_required` at aal1,
   `forbidden` at aal2. Other origins and a missing Origin are refused.
6. It checks that an owner session ended by sign-out gets 401 while its
   access token is still unexpired.
7. It deletes everything it created, also when a check fails.

It prints no passwords, tokens or keys. Audit rows for the throwaway accounts
stay in `audit.events`, which is append-only by design.

Manual spot checks:

```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/maintenance                 # 401
curl -i -X POST http://127.0.0.1:54321/functions/v1/maintenance \
  -H "x-cron-secret: $(grep '^CRON_SECRET=' supabase/.env | cut -d= -f2-)"      # 200 + counts
curl -i -X POST 'http://127.0.0.1:54321/functions/v1/maintenance?sweep=1' \
  -H "x-cron-secret: $(grep '^CRON_SECRET=' supabase/.env | cut -d= -f2-)"      # forces orphan sweep + retention
```

### Local CORS is not production CORS

The local Kong gateway has a CORS plugin on `/functions/v1`. It answers every
preflight itself with `Access-Control-Allow-Origin: *` and rewrites that header
on every response to `*`. So in a local browser, the admin console works from
any origin. The function's own Origin check still refuses other origins (403).
Hosted Supabase passes the function's own answers through.

To see what the function itself answers, send the request straight to the
edge runtime, past Kong:

```bash
docker exec supabase_kong_usmfomo sh -c "(printf 'OPTIONS /owner-admin HTTP/1.1\r\nHost: edge_runtime:8081\r\nOrigin: http://127.0.0.1:5174\r\nAccess-Control-Request-Method: POST\r\nConnection: close\r\n\r\n'; sleep 2) | nc edge_runtime 8081"
# expect 204 with access-control-allow-origin: http://127.0.0.1:5174; another Origin gets 403 with no CORS headers
```

After the first deploy, check the hosted function the same way:

```bash
curl -i -X OPTIONS https://<ref>.supabase.co/functions/v1/owner-admin \
  -H 'Origin: https://usmfomo-admin.pages.dev' -H 'Access-Control-Request-Method: POST'   # 204, exact origin
curl -i -X OPTIONS https://<ref>.supabase.co/functions/v1/owner-admin \
  -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST'             # 403, no CORS headers
```

In production, `ADMIN_ORIGINS` must be only `https://usmfomo-admin.pages.dev`,
with no localhost entries.

## Owner CLI locally

```bash
pnpm account --help
pnpm account seed-local      # owner + demo-club (club) + demo-school (school); passwords printed once
pnpm account list
```

- `seed-local` refuses any URL that is not the local stack. It skips accounts
  that already exist. Use `pnpm account reset-password <name>` to print a new
  password for one of them.
- Without `SUPABASE_SECRET_KEY`, the CLI reads the local key from
  `pnpm supabase status -o env`.
- A hosted project always needs the key passed for one command (see
  `docs/api.md`) and an `https://` URL.
- The CLI cannot delete owner accounts. To remove a local test owner, delete
  its user in Studio > Authentication; its account row cascades.

## Cron Worker locally

`workers/cron/.dev.vars` is git-ignored. It holds `SUPABASE_PUBLISHABLE_KEY`
(from `pnpm supabase status -o env`) and the local `CRON_SECRET`. Then run:

```bash
pnpm --filter cron dev                                     # wrangler dev --test-scheduled
curl 'http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=7+*+*+*+*'
```

A successful run logs `{"event":"maintenance","ok":true,...}` with counts
only. A failing step makes the invocation error (`usmfomo-cron failed:
maintenance: HTTP 401`). There is no fetch handler, so `GET /` answers 500.
