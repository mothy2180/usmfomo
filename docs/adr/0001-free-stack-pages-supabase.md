# ADR 0001 — Host on Cloudflare Pages and use Supabase Free as the whole backend

**Status**: Accepted · **Date**: 2026-10-05

## Context

usmfomo must cost nothing to run, need no card, and survive a deliberately heavy
landing page (many looping clips) at the scale of a ~30,000-student campus. It
needs managed authentication for a few hundred owner-created posting accounts,
file storage for posters, scheduled cleanup, and strong access control. The
developer works solo and part-time, so every extra runtime is something to
patch and watch. The sibling project (FirstApp) already chose Cloudflare +
Supabase, so the stack is learned once.

Verified 2026-10-05:
- Cloudflare static asset requests are free and unlimited. Vercel Hobby pauses a
  site after 100 GB/month; Netlify Free allows about 15 GB; Firebase Spark 10 GB.
- Cloudflare Pages and Workers answer Range requests with 200, not 206, so
  iPhones cannot stream `<video>` from them; clips must be downloaded whole and
  played from a typed Blob URL.
- Only Pages accepts a custom subdomain by CNAME from DNS we don't control
  (a possible `usmfomo.cs.usm.my` later). `.cs` is not a real TLD.
- Supabase Free (Singapore): 500 MB database, 1 GB storage, 5 + 5 GB egress,
  TOTP and CAPTCHA included; pauses after ~7 days of low API activity; no
  backups; SQL deletes on storage objects are blocked; new tables get no
  automatic GRANTs. Firebase Spark lost Cloud Storage in Feb 2026; Appwrite Free
  pauses on console inactivity; R2 and Cloudflare Access need a payment method.

## Decision

- Static React + Vite SPA and the three.js landing on **Cloudflare Pages**
  (`usmfomo.pages.dev`), owner console as a second Pages project
  (`usmfomo-admin.pages.dev`), deployed from GitHub Actions.
- **Supabase Free** (ap-southeast-1, its own organisation) for Postgres + RLS,
  Auth, Storage and two Edge Functions. Postgres (GRANTs, RLS, SECURITY DEFINER
  helpers, triggers) is the security perimeter.
- An hourly **Cloudflare Worker Cron Trigger** calls the maintenance function
  (cleanup + heartbeat) and makes an anonymous REST read, which keeps the free
  project from pausing. Not GitHub Actions schedules (disabled after 60 idle
  days) and not pg_cron (does not count as activity, cannot run while paused).
- Landing media ships inside the Pages site, never through Supabase egress.

## Consequences

- No backups on Free: everything must be reproducible from migrations; posts
  are temporary by design.
- The public Supabase URL is not behind Cloudflare, so a quota-flooding attack
  is an accepted residual risk with a degraded-mode switch and a runbook.
- Free-tier limits are re-verified before launch and recorded with dates.
