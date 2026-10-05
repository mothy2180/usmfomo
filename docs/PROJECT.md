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
  2024, P.U.(A) 329, r.12) — draft to be prepared; optionally ask for
  `usmfomo.cs.usm.my` in the same letter.
- Create a usmfomo-only contact channel (new Gmail or Instagram).
- Create the Supabase org/project (Singapore, "automatically expose new tables"
  unticked), the Cloudflare account and Turnstile widget, then claim the Pages
  projects `usmfomo` and `usmfomo-admin`.

## 8. Journal (newest first)

### 2026-10-05 — Plan approved; repo and database security core
- **Done**: research (hosting, BaaS, domain, three.js, security, Docker) with
  fact-checks; 5-lens review of the plan; repo with repo-local mothy2180
  identity; pnpm 12 workspace with supply-chain settings; Supabase CLI config
  hardened; migrations 0001–0050; 117 pgTAP tests green; db lint clean;
  security advisor shows no errors.
- **Decisions**: see §2 (all dated 2026-10-05).
- **Next**: web app scaffold (Vite multi-page, routing spike), CI workflow,
  owner sign-ups (Supabase, Cloudflare, Turnstile).
