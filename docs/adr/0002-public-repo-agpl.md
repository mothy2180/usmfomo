# ADR 0002 — Public repository under mothy2180, licensed AGPL-3.0-only

**Status**: Accepted · **Date**: 2026-10-05

## Context

GitHub's secret scanning, push protection and CodeQL are free only for public
repositories, and public repos get unlimited Actions minutes. The owner keeps a
personal GitHub identity strictly separate from a work identity.

## Decision

- Public repository `github.com/mothy2180/usmfomo`, licence AGPL-3.0-only
  (same as FirstApp).
- Commits use the repo-local identity "Timothy Thomas" with mothy2180's noreply
  address, set before the first commit; pushes go over HTTPS with a repo-local
  credential helper (`docs/runbooks/github-account.md`). The work account and
  email never appear in files or history.
- The list of club/school accounts and their contacts, and landing-media
  permission records, stay out of the repository.

## Consequences

- Anyone may reuse the code; anyone running a modified copy as a website must
  publish their changes.
- Landing-page media is © its owners and explicitly excluded from the AGPL
  (`NOTICE.md` next to the media).
