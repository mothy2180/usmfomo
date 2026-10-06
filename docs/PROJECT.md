# usmfomo — project reference

Single source of truth for decisions, architecture, limits, roadmap and the
journal. Decision rows are never deleted, only superseded. Source labels:
*(verified YYYY-MM-DD)*, *(secondary)*, *(unconfirmed)*.

## 1. Problem and promise

USM students have no single place to see what is happening on campus; most club
and school events go unnoticed. usmfomo shows every upcoming club and school
event in one place, without sign-up, and deletes each post when its event ends.

Non-negotiables: free to run (no card) · students never need an account · only
owner-created accounts can post (one per club/school) · Postgres enforces every
rule, the UI only mirrors it · unofficial project, says so on every page.

## 2. Decision log (newest first)

| Date | Decision | Options considered | Chosen | Why |
|---|---|---|---|---|
| 2026-10-06 | Owner console second TOTP device | allow 'continue with one device'; require two | require two: the console opens only when Auth lists two verified factors. There is no skip, a listing error never counts as two, and limited mode needs two as well | the approved plan ('only the TOTP enrolment screen until two devices are enrolled'); with one lost phone, the only way back in would be the break-glass CLI |
| 2026-10-06 | Owner console aal1 pre-check fails | continue to owner 2FA ('unknown'); fail closed | retry my_posting_status once, then treat it as a failed sign-in: sign out with scope local and show an error | a club must never be pushed into enrolling owner 2FA, or signed out globally (the docs/api.md promise) |
| 2026-10-06 | Owner console sign-out scope | always global; global only for a confirmed owner | global only after owner-admin `status` has confirmed the owner in this session; local before that (code, enrolment, status error) and in limited mode, including the idle sign-out | a club account that reaches these steps must not end every committee member's session; limited mode never got owner-admin's confirmation |
| 2026-10-06 | Moderation when Storage keeps files | report success; warn | when owner-admin returns failedFiles > 0, the dialog stays open with a warning (files public until the daily clean-up, up to two days) and lists the post's file paths | the owner must know the poster is still reachable and how to remove it sooner |
| 2026-10-06 | Maintenance health in the console | heartbeat age only; also the last result | danger 'Failed' badge when the last result has ok false or any failed step; the daily sweep turns red after 26 h | the heartbeat time moves at the start of every run, even one that fails (the 2026-10-05 'looks healthy' concern) |
| 2026-10-06 | Form field borders (both apps) | keep --color-line; a separate token | --color-field-line #6b7790 (at least 3:1 on ink, surface and surface-2) for inputs, selects and text areas; --color-line stays for dividers | WCAG 1.4.11: the old field edge was 1.5:1 |
| 2026-10-06 | Studio idle sign-out (shared lab PCs) | none (close the tab); server inactivity timeout or time-box (paid plan); client idle timer | client: 30 min without input, warning at 28 (ported from the owner console), last-input time saved in sessionStorage; a session idle that long, or with no saved time, is signed out (local) before use | closing a tab doesn't end a sessionStorage session: reopening the tab or restoring the browser session brings it back; the copy now says to always press Sign out on shared computers |
| 2026-10-06 | Who decides 'needs a 2FA code' in the studio | cached supabase-js AAL; database | my_posting_status whenever it answered; the cached AAL only as a fallback, refreshed when stale | the cached user keeps devices the admin or another member removed, which made /studio and /login/mfa redirect to each other |
| 2026-10-06 | Poster files after a failed post write | always remove; remove only after a definite refusal | remove only after a SQLSTATE/PGRST code or HTTP 4xx; otherwise leave them for the orphan sweep, and a retry of a new post first looks for the row (poster_path, or the same details) | a lost response may mean the row was written; deleting its files broke live posts, and blind retries used up daily slots with duplicates |
| 2026-10-06 | Deploy tools in the deploy job | setup-cli + wrangler-action (npm install without a lockfile, with the Cloudflare token already in the environment); a separate npm lockfile under tools/; the root pnpm lockfile | install the root package (Supabase CLI, wrangler) with `pnpm install --frozen-lockfile` from package.json, pnpm-lock.yaml and pnpm-workspace.yaml (their own artifact and folder) in a step with no secrets, then call `supabase`/`wrangler` directly with step-level tokens | no credential in the environment while anything installs or runs an install script; the exact, integrity-checked versions CI ran; one lockfile for laptop, CI and deploy. Supersedes 'deploy without installs' (CI/CD shape) and 'setup-cli pinned to package.json's version in deploy' (2026-10-05) |
| 2026-10-06 | Deploy concurrency | workflow level; deploy job | `deploy-production` on the deploy job, cancel-in-progress false | a run whose gate is skipped (failed or PR CI on a branch named main) can no longer replace a deploy that is waiting |
| 2026-10-06 | Setting production function secrets | one `secrets set` per name; both names in one command | CRON_SECRET and ADMIN_ORIGINS always together with explicit values, after `hide_local_env` (all supabase/ and root .env* files aside, SUPABASE_* unset), checked against the `secrets list` SHA-256 digests; CRON_SECRET also kept in the password manager | CLI 2.119.0 uploads every [edge_runtime.secrets] value it can fill from local env files with any `secrets set` (verified against a fake API) |
| 2026-10-06 | Config overrides in the guard | merge and check each [remotes.*]; refuse | check-config.py refuses any [remotes.*] table and a supabase/config.json, and also checks enable_confirmations, refresh-token rotation, password_requirements, max_enrolled_factors = 10, auth hooks off and SMTP off | one project, no branching; the CLI would push an overlay or config.json instead of the checked values |
| 2026-10-06 | Cron run without CRON_SECRET | stop before any request; read, then fail | the keep-alive read always runs, then the run fails with `maintenance: CRON_SECRET is not set` | the free project must not pause while the Worker secret is missing or lost |
| 2026-10-06 | Self-service password changes (SEC-2) | detect only (audit-log warning in the console); block in the database | block: a BEFORE UPDATE trigger on auth.users refuses a new hash unless the service-only admin_allow_password_change left a one-time grant (60 s, single use); owner-admin reset/handover and the CLI ask for it right before the Auth Admin update; covers every account, owner included | Auth makes the same UPDATE, as the same DB role, for a user's own change and for an admin reset; no app offers self-service password change; the owner's break-glass stays the CLI |
| 2026-10-06 | Shape of the auth.users trigger | BEFORE UPDATE OF encrypted_password; BEFORE UPDATE with the check in the function | no column list | a trigger column list makes ALTER COLUMN TYPE fail (verified on Postgres 17), which would break a future Auth migration of encrypted_password; Supabase warns that its auth columns may change |
| 2026-10-06 | Auth re-encrypting stored hashes at sign-in (its encryption at rest) | refuse (breaks sign-in); allow (opens a hole); keep the stored hash | keep the stored hash (silent no-op); a new hash under the same key id is still refused | sign-in must keep working if the platform turns encryption at rest on; the no-op never applies an ungranted change |
| 2026-10-06 | Lists longer than PostgREST max_rows (DC-1, SEC-1, DC-3) | raise max_rows; page; return jsonb | per-account decisions use direct jsonb lookups (admin_get_account, admin_get_account_by_username); admin_list_accounts is paged (p_limit <= 100, p_offset, total order with a user_id tiebreak) and both ports read it to a short page; the purge, the orphan sweep and an org's file list return one jsonb array | max_rows = 100 stays a security baseline; a single (scalar) value is never cut; the owner console's API is unchanged |
| 2026-10-06 | Published local CRON_SECRET (OPS-1) | runbook only; also refuse in code | maintenance refuses the supabase/.env.example value unless SUPABASE_URL is the local stack | defence in depth: `supabase secrets set` can upload local values, and the platform sets SUPABASE_URL |
| 2026-10-06 | Which secret key the Edge Functions use (OPS-6) | "default" only; a SECRET_KEY_NAME secret; fall back to the only key | "default", else the only sb_secret_ key; several keys and none named "default" is an error | a replacement key under another name no longer breaks both functions; ambiguity fails loudly instead of guessing |
| 2026-10-06 | Focus after a client-side navigation | each page focuses its own h1; one router-level handler | one handler (components/pageFocus.ts, on the router's onRendered) moves focus to the new page's main h1 after every path change; it skips the first load and search-only changes and never takes focus from an element that has it | screen-reader and keyboard users heard nothing after a link (WCAG 2.4.3); one place instead of every route |
| 2026-10-06 | Public header and native controls | sticky everywhere; sticky from lg | sticky only from 64rem with scroll-padding-top 5rem (like the console); `color-scheme: dark` on the public site | a sticky header hid focused elements on narrow or zoomed screens (WCAG 2.4.11); light-mode pickers were invisible on the dark UI |
| 2026-10-06 | Dashboard while public reads are off | 'no results' states; hidden-events notice only without filters; notice whenever both lists are empty | notice whenever both lists come back empty, with or without filters (a remembered campus or a shared link counts); the screen-reader result summary waits for both lists and the public-read check, then says 'Events are hidden for a while.', never '0 events' | hidden events must never read or sound like 'nothing matches' |
| 2026-10-06 | Image proxy without SUPABASE_URL | throw; logged 500 'Misconfigured' | logged 500 after the path check and the cache lookup | the deploy smoke test can now tell a missing Pages variable from a missing poster |
| 2026-10-06 | Language on the landing page | dashboard only; landing header too | EN/BM switch in the landing header (the static landing.html copy is English); BM says 'pentadbir usmfomo' everywhere | a BM speaker could not switch before the dashboard |
| 2026-10-06 | Postgres version in the config guard | unchecked; pinned | `[db] major_version = 17` checked by check-config.py; deploy.md step 1 says to confirm 17 | migration 0052 uses pg_input_is_valid (Postgres 16+) |
| 2026-10-05 | Landing media tier T3 (8 s two-clip atlas after 3 s of smooth playback) | build now; later | later, with the real clips | the synthetic 4 s atlases use 0.9 MB of the 6 MB desktop budget; T3 only pays off once there are enough real clips to fill it |
| 2026-10-05 | Landing scene (owner) | one shattered pane that explodes on click; glass floating past the viewer | shards drifting slowly towards and past the camera: clip/poster facets mixed with clear splinters; "I'm FOMO" warps through them, then navigates | the owner's reference ("floating around and pass by"); Mix + Slow drift chosen by the owner; drops d3-delaunay |
| 2026-10-05 | Maintenance reports partial failure | 200 with warnings; 500 | 500 `{ok:false, failed:[steps]}`, deletions kept | the cron run shows as errored in Workers Logs instead of looking healthy |
| 2026-10-05 | Owner console sign-in for club accounts | force TOTP like the owner; refuse early | aal1 `my_posting_status` pre-check → "not the owner" | club 2FA stays optional (owner decision) |
| 2026-10-05 | Reduced motion on the landing | hard block; start paused | start paused, the visitor may opt in | WCAG 2.2.2 + respect the OS setting; the explosion stays off |
| 2026-10-05 | Landing media until the owner sends clips | wait; ship synthetic | synthetic test-pattern atlases (1.4 MB) | the scene and its budgets can be tested now; swapped by re-running the pipeline |
| 2026-10-05 | CI/CD shape | one workflow; CI + gated deploy | CI on every push/PR; deploy only after CI passes on main (gate job), build without secrets, deploy without installs or caches | supply-chain isolation; green before accounts exist |
| 2026-10-05 | Supabase CLI in CI | setup-cli everywhere; pnpm devDependency | `pnpm exec supabase` in CI, setup-cli pinned to package.json's version in deploy | one version source; setup-cli can't read pnpm 12's lockfile |
| 2026-10-05 | Production public values | environment vars; repository vars | `VITE_*` as repository variables, project/account ids as environment variables | the build job deliberately has no environment (no secrets) |
| 2026-10-05 | Owner console on its own origin | /owner route in the public SPA; separate Pages project | `usmfomo-admin.pages.dev`, memory-only session | XSS or a bad dependency on the media-heavy public origin must not reach an aal2 owner token |
| 2026-10-05 | 3D library | React Three Fiber + drei; plain three.js | plain three.js r186 + d3-delaunay | fewer dependencies (drei pulls 21), no React peer-range lock, simpler v1 |
| 2026-10-05 | Routing on Pages | `/* /app.html 200`; explicit rewrites; `/ /landing 200` + SPA fallback | `/ /landing 200`, no 404.html | the splat rewrite loops forever on Pages (308 to /app re-matches) |
| 2026-10-05 | Scheduler + keep-alive | pg_cron; GitHub Actions schedule; Cloudflare Worker cron | Worker cron, hourly | pg_cron doesn't count as activity; GH schedules disable after 60 idle days |
| 2026-10-05 | Extra post fields (owner) | none; description; registration link | description + link | owner's choice |
| 2026-10-05 | Repo + licence (owner) | public MIT; public AGPL; private | public, AGPL-3.0-only | owner's choice; free GitHub security tooling (ADR 0002) |
| 2026-10-05 | Club/school 2FA (owner) | required; optional | optional; owner always TOTP | owner's choice |
| 2026-10-05 | Supabase free slots (owner) | one each; usmfomo first | usmfomo takes one now; FirstApp later | owner's choice |
| 2026-10-05 | Web address (owner) | free subdomain; USM subdomain; buy a domain | `usmfomo.pages.dev` | `.cs` does not exist; free; a USM CNAME stays possible |
| 2026-10-05 | Account management (owner) | CLI + dashboard; in-app console | in-app owner console (plus CLI as break-glass) | owner's choice |
| 2026-10-05 | When an event is over (owner) | optional end; required end; start only | start AND end required | owner's choice |
| 2026-10-05 | Notice section (owner) | auto "happening soon"; owner announcements; notice-type posts | owner-only announcements | owner's choice |
| 2026-10-05 | Stack | Next.js + Vercel; Firebase; Cloudflare-only; Vite + Pages + Supabase | Vite SPA + Pages + Supabase Free | ADR 0001 |

Assumptions the owner may still correct: English UI with a Bahasa Malaysia
toggle at launch · campus field (Main, Engineering, Health, Other, Online) ·
FirstApp coding waits until usmfomo's soft launch · the Notice strip is hidden
when no notice is live.

## 3. Architecture

```
usmfomo.pages.dev        public site + club studio (strict CSP via _headers)
  /     landing.html  static glass markup -> lazy three.js scene
  /*    index.html    app shell: /dashboard, /e/:id, /o/:slug, /login, /studio
  /i/*  Pages Function: same-origin image proxy with the Cache API
usmfomo-admin.pages.dev  owner console only
        | HTTPS: sb_publishable_ key + user JWT
Supabase (ap-southeast-1, org "usmfomo")
  Postgres  GRANTs + RLS + SECURITY DEFINER helpers + triggers = security perimeter
  Auth      username -> username@usmfomo.pages.dev, password, Turnstile, optional TOTP
  Storage   public bucket "posters", writes only into the org's own folder
  Edge Fns  owner-admin (aal2 owner) · maintenance (x-cron-secret)
Cloudflare Worker usmfomo-cron (no URL) --hourly--> REST read + maintenance
```

## 4. Security model (Module 5)

Database (`supabase/migrations`, tested by `supabase/tests`, 117 checks):
- Only `public` is exposed. anon/authenticated get SELECT on orgs, posts,
  notices, site_settings; clubs get column-scoped INSERT/UPDATE and DELETE on
  posts. `private` and `audit` are unreachable; service-only `maint_*`/`admin_*`
  RPCs are the Edge Functions' only way in.
- Every org write goes through `private.my_org_id()`: active account, active
  org, MFA satisfied (aal2 once a verified factor exists) and a **live session**
  (a password reset revokes already-issued tokens immediately).
- Owner = `private.is_owner()`: owner account, aal2, live session.
- Trigger rules: kill switch, start/end windows, 15 live posts, 5 new per 24 h
  (from an append-only log), 30 edits per 24 h, 400-day lifetime, exact storage
  paths. CHECKs: lengths, https links without userinfo, no control characters.
- Storage: 2 MiB, WebP/JPEG only, own folder, 40 objects per org, bucket under
  800 MiB, no listing, no overwrite.
- Auth: sign-ups off globally (Email provider on for password login), TOTP,
  Turnstile, 30-minute JWTs, no email ever sent.

## 5. Free tier and traps *(verified 2026-10-05)*

| Service | Free allowance | Trap | Mitigation |
|---|---|---|---|
| Cloudflare Pages | unlimited static requests, 20k files, 25 MiB/file | Range answered with 200 (iOS video) | Blob URL playback |
| Cloudflare Workers | 100k requests/day, 5 crons/account, 10 ms CPU | `workers_dev` defaults on | `workers_dev: false`, `preview_urls: false` |
| Supabase | 500 MB DB, 1 GB storage, 5 + 5 GB egress, 500k fn calls | pauses after ~7 idle days; over quota → grace once, then 402 org-wide | hourly REST read + heartbeat; caps; image proxy cache |
| Supabase | no backups, 1-day logs, image transforms Pro-only | — | migrations in git; browser re-encode |
| GitHub | unlimited Actions minutes on public repos | scheduled workflows disabled after 60 idle days | not used for anything that matters |

## 6. Roadmap

| Phase | Done means | Owner steps |
|---|---|---|
| P0 Setup + spikes | routing/headers curl checks on Pages; auth + RLS with new keys; iPhone Blob-video texture; pgTAP harness in CI | logins; Supabase project; Turnstile widget; phone test; USM permission request; contact channel |
| P1 Database + security core | all migrations; pgTAP denial sweep green; Advisor 0 errors | review the posting rules |
| P2 Dashboard + static landing | dashboard, event/organiser pages, notices, image proxy, i18n, OG tags, a11y | check BM wording |
| P3 Club studio + CLI | login, Turnstile, TOTP, quotas shown, CRUD, poster pipeline | try it as a club |
| P4 Expiry + go-live | maintenance + cron live; expired post and files gone within the hour | secrets; resume Supabase if paused |
| P5 Owner console | handover, reset, MFA removal, moderation, notices, kill switches | create owner + 2 TOTP devices; pilot clubs (soft launch) |
| P6 3D landing v1 | atlas pipeline with real media; device matrix passes | send media; approve debug grid |
| P7 Hardening + launch | verification list passes; USM permission received or risk accepted | announce |

## 7. Open items for the owner

- Request the Vice-Chancellor's written permission (USM Student Discipline Rules
  2024, P.U.(A) 329, r.12) — the letter is ready in
  `docs/runbooks/usm-permission-letter.md` (BM + EN; check the citation against
  the gazette first); optionally ask for `usmfomo.cs.usm.my` in the same letter.
- Create a usmfomo-only contact channel (new Gmail or Instagram).
- Create the Supabase org/project (Singapore, "automatically expose new tables"
  unticked), the Cloudflare account and Turnstile widget, then claim the Pages
  projects `usmfomo` and `usmfomo-admin`.

## 8. Journal (newest first)

### 2026-10-06 — Review fixes; the landing becomes floating glass
- **Done**: the landing scene follows the owner's reference: glass shards
  drift slowly towards and past the viewer (clip and poster facets mixed with
  clear splinters), and "I'm FOMO" warps through them before the dashboard
  opens. d3-delaunay is gone; phones get their own placeholder; og.jpg and
  apple-touch-icon.png exist, and the Pages check fails on a head reference
  to a missing file.
- **Review**: a five-lens adversarial review of the whole codebase found 48
  problems (4 high, 14 medium, 30 low). The landing ones were fixed with the
  rework. Five agents with separate file ownership fixed the rest, and each
  area was then checked by an independent agent trying to refute the fixes;
  it found one gap (the dashboard's screen-reader summary), which was
  repaired. The main changes: account actions no longer break past 100 clubs
  (PostgREST max_rows); clubs can no longer change their own password (a
  trigger on auth.users, migration 0052); studio sessions end after 30 idle
  minutes; the owner console requires two TOTP devices and fails closed; the
  deploy runbook can no longer publish the local CRON_SECRET, and maintenance
  refuses that value off the local stack; no deploy credential is in the
  environment during an install.
- **Verified**: lint, typecheck and builds; 619 unit tests (web 425, admin
  147, shared 31, cron 16), 69 CLI tests, 160 pgTAP tests, 118 Deno tests,
  the e2e function checks (75), the security advisors, the schema lint, the
  config guard (44 checks, 52 mutations rejected), the Pages output check and
  actionlint.
- **Note**: the first fix attempt stalled overnight (every agent at once, no
  changes made); the re-run completed.
- **Next**: push to github.com/mothy2180/usmfomo; then the owner's account
  setup (Cloudflare first: claim both Pages names, then Supabase, Turnstile)
  and the first deploy, following docs/runbooks/deploy.md; real landing media;
  device tests.


### 2026-10-05 (afternoon) — P2–P6 built locally in parallel
- **Done**: six agents with disjoint file ownership built the public pages
  (dashboard, event, organiser, rules), the club studio (login + Turnstile,
  TOTP, status bar, post form with in-browser poster shrinking, settings), the
  owner console (`apps/admin`), both Edge Functions with Deno tests, the cron
  Worker, the owner CLI, CI/CD + Dependabot + config guard, the runbooks
  (including the USM permission letter in BM and EN) and the landing v1
  (vanilla three.js shattered glass, typed-Blob atlas video, motion controls,
  ffmpeg-in-Docker atlas pipeline with synthetic dev media).
- **Verified**: 482 unit tests (web 345, admin 93, shared 31, cron 13), 102
  Deno tests, CLI tests, 117 pgTAP tests, security advisor and db lint clean,
  config guard + self-test, Pages output check, actionlint, all builds.
- **Note**: three session interrupts (13:12, 13:28, 13:46) killed the running
  agents; the workflow restarted them and files on disk survived.
- **Next**: independent security/correctness review of the new code; then the
  owner's account setup (Supabase, Cloudflare, Turnstile, GitHub) and the
  first deploy; real landing media; device tests.

### 2026-10-05 — Plan approved; repo and database security core
- **Done**: research (hosting, BaaS, domain, three.js, security, Docker) with
  fact-checks; 5-lens review of the plan; repo with repo-local mothy2180
  identity; pnpm 12 workspace with supply-chain settings; Supabase CLI config
  hardened; migrations 0001–0050; 117 pgTAP tests green; db lint clean;
  security advisor shows no errors.
- **Decisions**: see §2 (all dated 2026-10-05).
- **Next**: web app scaffold (Vite multi-page, routing spike), CI workflow,
  owner sign-ups (Supabase, Cloudflare, Turnstile).
