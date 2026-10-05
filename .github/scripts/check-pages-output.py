#!/usr/bin/env python3
"""Checks the Cloudflare Pages build output before it ships (ci.yml and deploy.yml).

Public site, apps/web/dist (Pages project usmfomo):
  * _headers, _redirects and _routes.json exist at the root, where Pages reads them;
  * no 404.html anywhere: it would switch off the SPA fallback that serves the app
    shell for every unknown path (docs/PROJECT.md, "Routing on Pages");
  * _redirects has no splat or placeholder rule (a splat rewrite loops on Pages);
  * _routes.json sends /i/* (the image proxy) to Functions and never everything,
    because every Function request counts against the Workers free quota.
Owner console, apps/admin/dist (usmfomo-admin): _headers exists, no 404.html.
Both: the Content-Security-Policy in _headers allows connect-src to the Supabase
origin of this build, and no file contains a Supabase secret key.

Usage:
  python3 .github/scripts/check-pages-output.py --supabase-url URL [--web DIR] [--admin DIR]
  python3 .github/scripts/check-pages-output.py --self-test
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SECRET_KEY = re.compile(rb'sb_secret_[A-Za-z0-9_-]{20,}')
CATCH_ALL_ROUTES = {'/*', '/', '*'}


def origin_of(url: str) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise ValueError(f'not an http(s) URL: {url!r}')
    return f'{parts.scheme}://{parts.netloc}'


def connect_sources(headers: str) -> list[list[str]]:
    """The connect-src source lists of every Content-Security-Policy line in a _headers file."""
    found = []
    for line in headers.splitlines():
        name, sep, value = line.strip().partition(':')
        if not sep or name.strip().lower() != 'content-security-policy':
            continue
        for directive in value.split(';'):
            words = directive.split()
            if words and words[0].lower() == 'connect-src':
                found.append(words[1:])
    return found


def common_checks(dist: Path, label: str, origin: str) -> list[str]:
    found: list[str] = []
    headers = dist / '_headers'
    if not headers.is_file() or headers.stat().st_size == 0:
        found.append(f'{label}: _headers is missing (security headers and CSP)')
    else:
        sources = connect_sources(headers.read_text(encoding='utf-8'))
        if not sources:
            found.append(f'{label}: _headers has no Content-Security-Policy with connect-src')
        elif not any(origin in s for s in sources):
            found.append(f'{label}: the CSP connect-src does not allow {origin} (was the build given VITE_SUPABASE_URL?)')
    for path in sorted(dist.rglob('*')):
        rel = path.relative_to(dist).as_posix()
        if path.name.lower() == '404.html':
            found.append(f'{label}: {rel} must not exist (it disables the Pages SPA fallback)')
        if path.is_file() and SECRET_KEY.search(path.read_bytes()):
            found.append(f'{label}: {rel} contains a Supabase secret key; only the publishable key may ship')
    return found


def check_web(dist: Path, origin: str) -> list[str]:
    label = 'web'
    if not dist.is_dir():
        return [f'{label}: {dist} does not exist (build apps/web first)']
    found = common_checks(dist, label, origin)
    redirects, routes = dist / '_redirects', dist / '_routes.json'
    if not redirects.is_file() or redirects.stat().st_size == 0:
        found.append(f'{label}: _redirects is missing ("/  /landing  200" serves the landing page at /)')
    else:
        for n, line in enumerate(redirects.read_text(encoding='utf-8').splitlines(), 1):
            words = line.split()
            if words and not words[0].startswith('#') and ('*' in words[0] or '/:' in words[0]):
                found.append(f'{label}: _redirects line {n} "{line.strip()}" is a splat/placeholder rule (loops on Pages)')
    if not routes.is_file():
        found.append(f'{label}: _routes.json is missing (only /i/* may invoke Functions)')
    else:
        try:
            include = json.loads(routes.read_text(encoding='utf-8')).get('include', [])
        except (ValueError, AttributeError):
            include = None
        if not isinstance(include, list):
            found.append(f'{label}: _routes.json is not a valid routes file')
        else:
            if '/i/*' not in include:
                found.append(f'{label}: _routes.json does not include /i/* (the image proxy)')
            if CATCH_ALL_ROUTES & set(map(str, include)):
                found.append(f'{label}: _routes.json sends every request to Functions (each one counts against the free quota)')
    return found


def check_admin(dist: Path, origin: str) -> list[str]:
    if not dist.is_dir():
        return [f'admin: {dist} does not exist (build apps/admin first)']
    return common_checks(dist, 'admin', origin)


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------

ORIGIN = 'https://example.supabase.co'


def good_web(path: Path) -> None:
    (path / 'assets').mkdir(parents=True)
    (path / '.well-known').mkdir()
    (path / '_headers').write_text(f"/*\n  Content-Security-Policy: default-src 'none'; connect-src 'self' {ORIGIN}\n")
    (path / '_redirects').write_text('/  /landing  200\n')
    (path / '_routes.json').write_text('{"version": 1, "include": ["/i/*"], "exclude": []}\n')
    (path / 'index.html').write_text('<!doctype html><title>usmfomo</title>\n')
    (path / 'assets' / 'index-abc123.js').write_text("if (key.startsWith('sb_secret_')) throw new Error('no')\n")
    (path / '.well-known' / 'security.txt').write_text('Contact: https://example.com\n')


def good_admin(path: Path) -> None:
    path.mkdir(parents=True)
    (path / '_headers').write_text(f"/*\n  Content-Security-Policy: default-src 'none'; connect-src {ORIGIN}\n")
    (path / 'index.html').write_text('<!doctype html><title>usmfomo admin</title>\n')


def self_test() -> int:
    fake_key = 'sb_' + 'secret_' + 'Z' * 32  # built at run time so secret scanners stay quiet
    web_cases = [
        ('missing _headers', lambda d: (d / '_headers').unlink(), '_headers is missing'),
        ('missing _redirects', lambda d: (d / '_redirects').unlink(), '_redirects is missing'),
        ('missing _routes.json', lambda d: (d / '_routes.json').unlink(), '_routes.json is missing'),
        ('nested 404.html', lambda d: (d / 'assets' / '404.html').write_text('x'), '404.html must not exist'),
        ('splat redirect', lambda d: (d / '_redirects').write_text('/*  /index.html  200\n'), 'splat'),
        ('placeholder redirect', lambda d: (d / '_redirects').write_text('/e/:id  /index.html  200\n'), 'splat'),
        ('catch-all routes', lambda d: (d / '_routes.json').write_text('{"version":1,"include":["/*"]}'), 'every request'),
        ('no image proxy route', lambda d: (d / '_routes.json').write_text('{"version":1,"include":[]}'), '/i/*'),
        ('broken routes', lambda d: (d / '_routes.json').write_text('[1, 2'), 'not a valid routes file'),
        ('CSP for another project', lambda d: (d / '_headers').write_text(
            "/*\n  Content-Security-Policy: connect-src 'self' http://127.0.0.1:54321\n"), 'does not allow'),
        ('secret key in a bundle', lambda d: (d / 'assets' / 'x.js').write_text(f'const k = "{fake_key}"'), 'secret key'),
    ]
    admin_cases = [
        ('admin 404.html', lambda d: (d / '404.html').write_text('x'), '404.html must not exist'),
        ('admin without _headers', lambda d: (d / '_headers').unlink(), '_headers is missing'),
    ]
    failures: list[str] = []
    with tempfile.TemporaryDirectory(prefix='check-pages-output-') as tmp:
        base_web, base_admin = Path(tmp) / 'web', Path(tmp) / 'admin'
        good_web(base_web)
        good_admin(base_admin)
        if got := check_web(base_web, ORIGIN) + check_admin(base_admin, ORIGIN):
            failures.append(f'a good build must pass, got {got}')
        for n, (name, damage, expected) in enumerate(web_cases + admin_cases):
            web, admin = Path(tmp) / f'web-{n}', Path(tmp) / f'admin-{n}'
            shutil.copytree(base_web, web)
            shutil.copytree(base_admin, admin)
            damage(admin if name.startswith('admin') else web)
            got = check_web(web, ORIGIN) + check_admin(admin, ORIGIN)
            if not any(expected in p for p in got):
                failures.append(f'{name}: expected a problem mentioning {expected!r}, got {got or "none"}')
    for line in failures:
        print(f'self-test FAILED: {line}', file=sys.stderr)
    if failures:
        return 1
    print(f'check-pages-output self-test: a good build passes; {len(web_cases) + len(admin_cases)} broken builds rejected')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Check the Pages build output of apps/web and apps/admin.')
    parser.add_argument('--supabase-url', help='the VITE_SUPABASE_URL the apps were built with')
    parser.add_argument('--web', type=Path, default=ROOT / 'apps' / 'web' / 'dist')
    parser.add_argument('--admin', type=Path, default=ROOT / 'apps' / 'admin' / 'dist')
    parser.add_argument('--self-test', action='store_true', help='run the built-in tests and exit')
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.supabase_url:
        parser.error('--supabase-url is required')
    try:
        origin = origin_of(args.supabase_url)
    except ValueError as err:
        parser.error(str(err))
    found = check_web(args.web, origin) + check_admin(args.admin, origin)
    for problem in found:
        print(f'check-pages-output: {problem}', file=sys.stderr)
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            print(f'::error title=check-pages-output::{problem}')
    if found:
        return 1
    print(f'check-pages-output: web and admin builds are ready for Pages (CSP allows {origin})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
