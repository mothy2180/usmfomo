# Learning path (FirstApp's evenings + usmfomo's additions)

For writing parts of usmfomo yourself. The plan budgets **≈270 hours** for that,
learning included: about **31 weeks at 10–12 hours a week**. Of that, the
learning below is **≈25 evenings, ≈58 hours** (an evening is ≈2.3 hours, the
same size as FirstApp's); the rest is building.

Rule (from FirstApp): learn a topic the week before the phase that uses it, and
write no trigger before the trigger evening (4). Phases: `docs/PROJECT.md` §6.

## FirstApp's evenings (≈32 h, 14 evenings; 12 apply here)

Shared with FirstApp, so the stack is learned once. Done for one project means
done for both.

| # | Phase | Topic | Resource | Time | usmfomo |
|---|---|---|---|---|---|
| 1 | P0 | RLS: policies, `auth.uid()` / `auth.jwt()`, column grants, Security Advisor, `security_invoker` | <https://supabase.com/docs/guides/database/postgres/row-level-security> | 1 evening | yes |
| 2 | P0 | pgTAP with `supabase test db` | <https://supabase.com/docs/guides/database/testing> | 1 evening | yes |
| 3–4 | P1 | PL/pgSQL functions and exceptions; row triggers (the trigger evening), Postgres 17 | <https://www.postgresql.org/docs/17/plpgsql.html> · <https://www.postgresql.org/docs/17/sql-createtrigger.html> | 2 evenings | yes: the posting limits are BEFORE triggers |
| 5–7 | P2 | TypeScript basics, types, generics, async | <https://www.typescriptlang.org/docs/handbook/intro.html> | 3 evenings | yes |
| 8–9 | P2 | React fundamentals: components, props, state, effects | <https://react.dev/learn> | 2 evenings | yes |
| 10 | P2 | Supabase quickstart (React) | <https://supabase.com/docs/guides/getting-started/quickstarts/reactjs> | 1 evening | yes |
| 11 | P3 | Supabase Auth MFA: TOTP enrol/challenge, `aal2` in RLS | <https://supabase.com/docs/guides/auth/auth-mfa> | 1 evening | yes: studio 2FA, owner console |
| 12 | — | PL/pgSQL deferred constraint triggers | <https://www.postgresql.org/docs/17/sql-createtrigger.html> | 1 evening | optional: usmfomo has none |
| 13 | P4 | Deno + Edge Functions incl. background tasks | <https://supabase.com/docs/guides/functions/background-tasks> | 1 evening | yes: `maintenance`, `owner-admin` |
| 14 | — | Curlec payments | (FirstApp only) | 1 evening | no |

## usmfomo's additions (≈30 h, 13 evenings)

| # | Phase | Topic | Resource | Time |
|---|---|---|---|---|
| 15 | P1 | Supabase Storage: buckets, `storage.objects` policies, deleting through the Storage API; the new API keys (publishable/secret) | <https://supabase.com/docs/guides/storage/security/access-control> · <https://supabase.com/docs/guides/api/api-keys> | 1 evening |
| 16 | P0/P2 | Cloudflare Pages: `_headers`, `_redirects` (why no splat and no `404.html`), Pages Functions and `_routes.json` | <https://developers.cloudflare.com/pages/configuration/headers/> · <https://developers.cloudflare.com/pages/configuration/redirects/> · <https://developers.cloudflare.com/pages/functions/routing/> | 1 evening |
| 17 | P4 | Workers Cron Triggers, `wrangler secret`, Workers Logs | <https://developers.cloudflare.com/workers/configuration/cron-triggers/> | 1 evening |
| 18 | P2/P3 | Content Security Policy; Turnstile (widget + server-side check) | <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP> · <https://developers.cloudflare.com/turnstile/get-started/> | 1 evening |
| 19 | P2 | Vite multi-page build, TanStack Router and Query, react-i18next | <https://vite.dev/guide/build.html> · <https://tanstack.com/router/latest/docs/framework/react/overview> · <https://tanstack.com/query/latest/docs/framework/react/overview> · <https://react.i18next.com/> | 1 evening |
| 20 | P2 | Accessibility: WCAG 2.2 AA (labels, focus, ARIA tabs, contrast, reflow) | <https://www.w3.org/WAI/WCAG22/quickref/> | 1 evening |
| 21–23 | P6 | three.js: scene, camera, renderer, geometry and UVs, materials, (video) textures, rendering on demand | <https://threejs.org/manual/> | 3 evenings |
| 24–25 | Later | GLSL basics: shaders for the 3D v2 glass (v1 uses built-in materials) | <https://thebookofshaders.com/> | 2 evenings |
| 26 | P6 | ffmpeg: filters (`scale`, `crop`, `xstack`, `photosensitivity`), H.264 profiles and levels | <https://ffmpeg.org/ffmpeg-filters.html> · <https://trac.ffmpeg.org/wiki/Encode/H.264> | 1 evening |
| 27 | P0/P4 | GitHub Actions security: least-privilege tokens, environments, SHA pinning, `workflow_run` | <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions> | 1 evening |

Evenings 24–25 can wait until 3D v2 (docs/PROJECT.md "Later"); without them the
total is ≈53 hours.

## How to practise each one

Read the resource, then change something small in this repo and run its check:
a pgTAP test for 1–4 and 15 (`pnpm supabase test db`), a Vitest test for 5–10
and 19 (`pnpm test`), `deno test` in `supabase/functions` for 13, a `curl -I`
against `pnpm --filter web pages:dev` for 16 and 18, `pnpm --filter cron dev`
(wrangler with `--test-scheduled`) for 17, axe in the browser for 20, the atlas
debug grid for 21–26 (`apps/web/scripts/build-landing-atlas.py`), and actionlint
on `.github/workflows` for 27.
