#!/usr/bin/env python3
"""Security-baseline guard for supabase/config.toml (runs in CI, see .github/workflows/ci.yml).

The local stack and CI run with this file, and `supabase config push` (by hand,
never from CI: docs/runbooks/deploy.md) copies it to the hosted project. This
script fails, with one line per key, if any of these settings drift:

  api        only `public` is exposed, max_rows 100, new tables are not exposed
  auth       sign-ups closed (the Email provider stays on for password login),
             no anonymous sign-ins or manual linking, 30-minute JWTs, passwords
             of 12+ characters, an https site_url, TOTP on, phone MFA off,
             Turnstile CAPTCHA with its secret read from the environment, SMS
             sign-ups off, no email notifications, no OAuth, Web3, third-party
             or OAuth-server sign-in
  storage    S3 protocol and vector buckets off
  realtime   off
  functions  maintenance and owner-admin authorise in code (verify_jwt false)

A missing key counts as drift: the CLI default would silently apply instead.
Values must have the right TOML type ("100" is not 100, true is not 1).

Usage:
  python3 scripts/check-config.py [CONFIG]      # default: supabase/config.toml
  python3 scripts/check-config.py --self-test   # mutated copies must fail
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

if sys.version_info < (3, 11):
    sys.exit('check-config.py needs Python 3.11 or newer (tomllib)')

import tomllib  # noqa: E402  (imported after the version check on purpose)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / 'supabase' / 'config.toml'
MISSING = object()

Check = Callable[[object], bool]


def equals(expected: object) -> Check:
    """Same TOML type and value."""
    return lambda value: type(value) is type(expected) and value == expected


def at_least(minimum: int) -> Check:
    return lambda value: type(value) is int and value >= minimum


def https_url(value: object) -> bool:
    return isinstance(value, str) and value.startswith('https://')


@dataclass(frozen=True)
class Rule:
    path: tuple[str, ...]
    check: Check
    expected: str
    why: str
    required: bool = True  # False: may be absent because the CLI default is already safe


@dataclass(frozen=True)
class EveryTable:
    """Every table under `prefix` (for example [auth.external.*]) must set enabled = false."""

    prefix: tuple[str, ...]
    why: str


RULES = [
    Rule(('api', 'schemas'), equals(['public']), '["public"]',
         'only public is exposed to the Data API; private and audit never are'),
    Rule(('api', 'max_rows'), equals(100), '100', 'hard cap on rows per request'),
    Rule(('api', 'auto_expose_new_tables'), equals(False), 'false',
         'new tables must get explicit GRANTs in their migration'),
    Rule(('auth', 'enable_signup'), equals(False), 'false',
         'the global sign-up switch: only the owner creates accounts'),
    Rule(('auth', 'email', 'enable_signup'), equals(True), 'true',
         'this is the Email provider switch that password login needs; '
         'sign-ups stay closed through [auth] enable_signup = false'),
    Rule(('auth', 'enable_anonymous_sign_ins'), equals(False), 'false', 'no anonymous accounts'),
    Rule(('auth', 'enable_manual_linking'), equals(False), 'false', 'no identity linking'),
    Rule(('auth', 'jwt_expiry'), equals(1800), '1800', '30-minute access tokens'),
    Rule(('auth', 'minimum_password_length'), at_least(12), 'an integer >= 12',
         'owner-generated passwords are long'),
    Rule(('auth', 'site_url'), https_url, 'an https:// URL', 'the production site is HTTPS only'),
    Rule(('auth', 'mfa', 'totp', 'enroll_enabled'), equals(True), 'true', 'TOTP 2FA (mandatory for the owner)'),
    Rule(('auth', 'mfa', 'totp', 'verify_enabled'), equals(True), 'true', 'TOTP 2FA (mandatory for the owner)'),
    Rule(('auth', 'mfa', 'phone', 'enroll_enabled'), equals(False), 'false', 'no SMS factors'),
    Rule(('auth', 'captcha', 'enabled'), equals(True), 'true', 'Turnstile in front of every login'),
    Rule(('auth', 'captcha', 'provider'), equals('turnstile'), '"turnstile"', 'the widget the apps render'),
    Rule(('auth', 'captcha', 'secret'), equals('env(TURNSTILE_SECRET)'), '"env(TURNSTILE_SECRET)"',
         'never a literal secret in git; production keeps it in the dashboard'),
    Rule(('auth', 'sms', 'enable_signup'), equals(False), 'false', 'no phone sign-ups'),
    Rule(('auth', 'oauth_server', 'enabled'), equals(False), 'false',
         'the project is not an OAuth provider', required=False),
    Rule(('storage', 's3_protocol', 'enabled'), equals(False), 'false', 'no S3 access keys to leak'),
    Rule(('storage', 'vector', 'enabled'), equals(False), 'false', 'unused'),
    Rule(('realtime', 'enabled'), equals(False), 'false', 'unused; the free plan caps connections'),
    Rule(('functions', 'maintenance', 'verify_jwt'), equals(False), 'false',
         'it checks x-cron-secret in code; new API keys are not JWTs'),
    Rule(('functions', 'owner-admin', 'verify_jwt'), equals(False), 'false',
         'it verifies an aal2 owner session in code; new API keys are not JWTs'),
]

EVERY_TABLE = [
    EveryTable(('auth', 'email', 'notification'), 'usmfomo never sends email'),
    EveryTable(('auth', 'external'), 'no OAuth sign-in'),
    EveryTable(('auth', 'web3'), 'no wallet sign-in'),
    EveryTable(('auth', 'third_party'), 'no tokens from other identity providers'),
]


def lookup(config: dict[str, object], path: tuple[str, ...]) -> object:
    node: object = config
    for part in path:
        if not isinstance(node, dict) or part not in node:
            return MISSING
        node = node[part]
    return node


def where(path: tuple[str, ...]) -> str:
    """('auth', 'email', 'enable_signup') -> '[auth.email] enable_signup'."""
    table, key = path[:-1], path[-1]
    return f'[{".".join(table)}] {key}' if table else key


def toml_value(value: object) -> str:
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, str):
        return f'"{value}"'
    if isinstance(value, list):
        return '[' + ', '.join(toml_value(v) for v in value) + ']'
    if isinstance(value, dict):
        return 'a table'
    return str(value)


def problems(config: dict[str, object]) -> tuple[list[str], int]:
    """Returns (problems, number of checks made)."""
    found: list[str] = []
    checks = 0
    for rule in RULES:
        checks += 1
        value = lookup(config, rule.path)
        if value is MISSING:
            if rule.required:
                found.append(f'{where(rule.path)} is missing; expected {rule.expected} ({rule.why})')
        elif not rule.check(value):
            found.append(f'{where(rule.path)} = {toml_value(value)}; expected {rule.expected} ({rule.why})')
    for group in EVERY_TABLE:
        tables = lookup(config, group.prefix)
        if tables is MISSING:
            continue
        if not isinstance(tables, dict):
            checks += 1
            found.append(f'[{".".join(group.prefix)}] must be a group of tables, got {toml_value(tables)}')
            continue
        for name, table in tables.items():
            checks += 1
            path = (*group.prefix, name, 'enabled')
            value = table.get('enabled', MISSING) if isinstance(table, dict) else table
            if value is MISSING:
                found.append(f'{where(path)} is missing; expected false ({group.why})')
            elif value is not False:
                found.append(f'{where(path)} = {toml_value(value)}; expected false ({group.why})')
    return found, checks


def check_file(path: Path) -> tuple[list[str], int]:
    try:
        text = path.read_text(encoding='utf-8')
    except OSError as err:
        return [f'cannot read the file ({err.strerror})'], 0
    try:
        config = tomllib.loads(text)
    except tomllib.TOMLDecodeError as err:
        return [f'not valid TOML ({err})'], 0
    return problems(config)


def shown(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def annotate(file: str, message: str) -> None:
    """A GitHub Actions error annotation, so the problem shows on the PR."""
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        text = message.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::error file={file},title=check-config::{text}')


# --------------------------------------------------------------------------
# Self-test: realistic edits of the real file must be caught
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Mutation:
    table: str
    key: str
    value: str | None  # a TOML literal; None deletes the key
    create: bool = False  # the table is new (appended to the file)

    def label(self) -> str:
        return f'[{self.table}] {self.key}'

    def describe(self) -> str:
        return f'{self.label()} deleted' if self.value is None else f'{self.label()} = {self.value}'


MUST_FAIL = [
    Mutation('api', 'schemas', '["public", "private"]'),
    Mutation('api', 'schemas', '["public", "graphql_public"]'),
    Mutation('api', 'max_rows', '1000'),
    Mutation('api', 'max_rows', '"100"'),
    Mutation('api', 'auto_expose_new_tables', 'true'),
    Mutation('api', 'auto_expose_new_tables', None),
    Mutation('auth', 'enable_signup', 'true'),
    Mutation('auth', 'enable_signup', None),
    Mutation('auth.email', 'enable_signup', 'false'),
    Mutation('auth', 'enable_anonymous_sign_ins', 'true'),
    Mutation('auth', 'enable_manual_linking', 'true'),
    Mutation('auth', 'jwt_expiry', '3600'),
    Mutation('auth', 'minimum_password_length', '11'),
    Mutation('auth', 'minimum_password_length', 'true'),
    Mutation('auth', 'site_url', '"http://usmfomo.pages.dev"'),
    Mutation('auth.mfa.totp', 'enroll_enabled', 'false'),
    Mutation('auth.mfa.totp', 'verify_enabled', 'false'),
    Mutation('auth.mfa.phone', 'enroll_enabled', 'true'),
    Mutation('auth.captcha', 'enabled', 'false'),
    Mutation('auth.captcha', 'provider', '"hcaptcha"'),
    Mutation('auth.captcha', 'secret', '"hard-coded-value"'),
    Mutation('auth.sms', 'enable_signup', 'true'),
    Mutation('auth.email.notification.password_changed', 'enabled', 'true'),
    Mutation('auth.email.notification.mfa_factor_enrolled', 'enabled', None),
    Mutation('auth.email.notification.some_future_template', 'enabled', 'true', create=True),
    Mutation('auth.external.apple', 'enabled', 'true'),
    Mutation('auth.external.github', 'enabled', 'true', create=True),
    Mutation('auth.web3.solana', 'enabled', 'true'),
    Mutation('auth.third_party.clerk', 'enabled', 'true'),
    Mutation('auth.oauth_server', 'enabled', 'true'),
    Mutation('storage.s3_protocol', 'enabled', 'true'),
    Mutation('storage.vector', 'enabled', 'true'),
    Mutation('realtime', 'enabled', 'true'),
    Mutation('realtime', 'enabled', None),
    Mutation('functions.maintenance', 'verify_jwt', 'true'),
    Mutation('functions.owner-admin', 'verify_jwt', 'true'),
    Mutation('functions.owner-admin', 'verify_jwt', None),
]

# Harmless edits that must still pass (the guard is not just "any change fails").
MUST_PASS = [
    Mutation('auth', 'minimum_password_length', '16'),
    Mutation('auth', 'site_url', '"https://usmfomo.cs.usm.my"'),
    Mutation('auth.external.github', 'enabled', 'false', create=True),
]


class SelfTestError(Exception):
    pass


def mutate(text: str, m: Mutation) -> str:
    """The text with one key of one [table] set, added or deleted."""
    lines = text.splitlines(keepends=True)
    header = f'[{m.table}]'
    start = next((i for i, line in enumerate(lines) if line.strip() == header), None)
    if start is None:
        if not m.create or m.value is None:
            raise SelfTestError(f'{header} is not in the base config')
        return text.rstrip('\n') + f'\n\n{header}\n{m.key} = {m.value}\n'
    end = next((i for i in range(start + 1, len(lines)) if lines[i].lstrip().startswith('[')), len(lines))
    key_line = re.compile(rf'^\s*{re.escape(m.key)}\s*=')
    for i in range(start + 1, end):
        if key_line.match(lines[i]):
            if m.value is None:
                del lines[i]
            else:
                lines[i] = f'{m.key} = {m.value}\n'
            return ''.join(lines)
    if m.value is None:
        raise SelfTestError(f'{m.label()} is not in the base config')
    lines.insert(start + 1, f'{m.key} = {m.value}\n')
    return ''.join(lines)


def self_test(base: Path) -> int:
    failures: list[str] = []
    found, checks = check_file(base)
    if found:
        failures.append(f'{shown(base)} must pass, but: {found[0]}')
    base_text = base.read_text(encoding='utf-8')
    with tempfile.TemporaryDirectory(prefix='check-config-') as tmp:
        for n, m in enumerate([*MUST_FAIL, *MUST_PASS], 1):
            try:
                text = mutate(base_text, m)
            except SelfTestError as err:
                failures.append(f'cannot apply "{m.describe()}": {err}')
                continue
            if text == base_text:
                failures.append(f'"{m.describe()}" did not change the file')
                continue
            copy = Path(tmp) / f'mutation-{n:02d}.toml'
            copy.write_text(text, encoding='utf-8')
            got, _ = check_file(copy)
            if m in MUST_PASS and got:
                failures.append(f'harmless "{m.describe()}" was rejected: {got[0]}')
            elif m in MUST_FAIL and not any(p.startswith(m.label()) for p in got):
                failures.append(f'"{m.describe()}" was not caught (got: {got or "no problems"})')
        broken = Path(tmp) / 'broken.toml'
        broken.write_text(base_text + '\n[auth\n', encoding='utf-8')
        if not any(p.startswith('not valid TOML') for p in check_file(broken)[0]):
            failures.append('invalid TOML was not reported')
        if not check_file(Path(tmp) / 'absent.toml')[0]:
            failures.append('a missing file was not reported')
    for line in failures:
        print(f'self-test FAILED: {line}', file=sys.stderr)
    if failures:
        return 1
    print(f'check-config self-test: {shown(base)} passes ({checks} checks); '
          f'{len(MUST_FAIL)} mutations rejected, {len(MUST_PASS)} harmless edits accepted, '
          'invalid TOML and a missing file reported')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Fail unless supabase/config.toml keeps the security baseline.')
    parser.add_argument('config', nargs='?', type=Path, default=DEFAULT_CONFIG,
                        help='path to config.toml (default: supabase/config.toml)')
    parser.add_argument('--self-test', action='store_true',
                        help='check that mutated copies of CONFIG fail and CONFIG itself passes')
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test(args.config)
    name = shown(args.config)
    found, checks = check_file(args.config)
    for problem in found:
        print(f'{name}: {problem}', file=sys.stderr)
        annotate(name, problem)
    if found:
        print(f'check-config: {len(found)} problem(s) in {name}; restore the security baseline '
              '(see the comments in the file and docs/runbooks/deploy.md)', file=sys.stderr)
        return 1
    print(f'check-config: {name} keeps the security baseline ({checks} checks)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
