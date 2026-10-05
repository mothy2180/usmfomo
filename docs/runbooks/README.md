# Runbooks

Operating procedures for usmfomo: when to use each one, then exact steps.
Commands run from the repository root on the owner's Mac (zsh) unless a step
says otherwise. Decisions and architecture: [`../PROJECT.md`](../PROJECT.md);
component contracts: [`../api.md`](../api.md).

## Setting up and shipping

| Runbook | Use it when |
|---|---|
| [github-account.md](github-account.md) | cloning, committing or pushing: the repo lives under **mothy2180**, never the work account |
| [local-dev.md](local-dev.md) | setting up a laptop, the daily loop, campus Wi-Fi, FirstApp's port clash, Docker tools |
| [functions-local.md](functions-local.md) | testing the Edge Functions, the cron Worker and the owner CLI locally |
| [deploy.md](deploy.md) | first-time production setup, how the pipeline deploys, smoke tests, changing project settings, rollbacks |
| [usm-permission-letter.md](usm-permission-letter.md) | asking the Vice-Chancellor for written permission (Student Discipline Rules 2024, r.12), BM + EN |
| [learning-path.md](learning-path.md) | learning the stack to write parts yourself (FirstApp's evenings + usmfomo's) |

## Accounts and incidents

| Runbook | Use it when |
|---|---|
| [onboard-club.md](onboard-club.md) | a club or school asks for an account |
| [handover.md](handover.md) | a committee changes (new office bearers) |
| [forgot-password.md](forgot-password.md) | a club forgot its password or lost its 2FA device |
| [owner-lockout.md](owner-lockout.md) | you (the owner) lost both TOTP devices, the password, or the `owner-cli` key |
| [account-takeover.md](account-takeover.md) | an account posts things its club did not, or a factor nobody recognises appears |
| [quota-attack.md](quota-attack.md) | Supabase usage jumps or someone floods the public API |

## Rules that apply to every runbook

- **Identity first.** Verify a club or school through its **official channel**
  before any account change.
- **Passwords go 1:1**: in person or a direct message to the verified contact,
  never in group chats, shared threads or screenshots.
- **Recovery order**: deactivate → reset password (ends every session) → remove
  factors → reactivate → the new committee enrols in one sitting.
- **Secrets stay out of files**: read them with `read -rs`, use them for one
  command, `unset` them. Only the publishable key ever reaches a browser.
- **`supabase config push` is by hand only**, after `config diff`; never from CI.
- Write incidents and their fixes into the journal in `docs/PROJECT.md`.
