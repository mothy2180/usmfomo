# Security policy

usmfomo lists campus events that trusted club and school accounts post for
Universiti Sains Malaysia students. Students browse without an account; posting
accounts are created only by the site owner. usmfomo is an independent,
unofficial student project. Security reports are welcome and taken seriously.

## Reporting a vulnerability

- Use GitHub's private vulnerability reporting:
  https://github.com/mothy2180/usmfomo/security/advisories/new
- Include steps to reproduce, the impact you believe it has, and whether any
  personal data was exposed. Do not include other people's personal data in the
  report.
- We aim to acknowledge within 3 working days and to give a remediation timeline
  within 10 working days.

## Safe harbour

Good-faith research that respects these rules will not lead to complaints or
legal action: no data exfiltration beyond what proves the issue, no denial of
service or quota exhaustion against the hosted project, no social engineering of
club or school admins, and no testing with or against real posting accounts —
run the local stack (`pnpm supabase start`) instead.

## Scope

In scope: the public web app (usmfomo.pages.dev), the owner console
(usmfomo-admin.pages.dev), the Supabase project's row-level security, functions
and storage policies, the scheduled maintenance job, and this repository's
CI/CD configuration.

Out of scope: Supabase, Cloudflare, GitHub and other vendors' own infrastructure
(report to them directly), and content that clubs and schools post (report it to
the usmfomo admin through the contact link on the site).

## Incident handling (internal)

Runbooks live in `docs/runbooks/` (account takeover, quota attack, owner
lockout). If a breach of personal data is likely to cause significant harm, the
Malaysian PDPA timelines are: notify the Personal Data Protection Commissioner
within 72 hours, then affected individuals within 7 days of that notification.
