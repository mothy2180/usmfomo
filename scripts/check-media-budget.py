#!/usr/bin/env python3
"""Byte budgets for the landing-page media shipped with the public site (runs in CI).

The 3D landing (Module 6) downloads one media set per device class from
apps/web/src/landing3d/media, which apps/web/scripts/build-landing-atlas.py writes:

  desktop set   <= 6 MB    files with "desktop" in their path, plus shared files
  mobile set    <= 2.5 MB  files with "mobile" in their path, plus shared files
  any file      <= 25 MiB  Cloudflare Pages' limit per file

Shared files (no device class in the path, e.g. tilemap.json) count towards both
sets. 1 MB = 1,000,000 bytes, as in the atlas script. Hidden files are ignored.
The check passes when the folder is missing or empty (before the media arrives).

Usage:
  python3 scripts/check-media-budget.py [--dir DIR]
  python3 scripts/check-media-budget.py --self-test
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA_DIR = ROOT / 'apps' / 'web' / 'src' / 'landing3d' / 'media'

MB = 1_000_000
MIB = 1024 * 1024
SET_CAPS = {'desktop': 6 * MB, 'mobile': 2_500_000}
FILE_CAP = 25 * MIB
CLASSES = tuple(SET_CAPS)


@dataclass(frozen=True)
class MediaFile:
    rel: str
    size: int
    klass: str  # 'desktop', 'mobile' or 'shared'


def classify(rel: str) -> str:
    """The device class named in the path ('atlas-mobile.mp4' -> 'mobile'), else 'shared'."""
    tokens = set(re.split(r'[^a-z0-9]+', rel.lower()))
    named = [k for k in CLASSES if k in tokens]
    return named[0] if len(named) == 1 else 'shared'


def scan(folder: Path) -> list[MediaFile]:
    if not folder.is_dir():
        return []
    files = []
    for path in sorted(folder.rglob('*')):
        rel = path.relative_to(folder)
        if any(part.startswith('.') for part in rel.parts) or not path.is_file():
            continue
        files.append(MediaFile(rel.as_posix(), path.stat().st_size, classify(rel.as_posix())))
    return files


def set_totals(files: list[MediaFile]) -> dict[str, int]:
    return {k: sum(f.size for f in files if f.klass in (k, 'shared')) for k in CLASSES}


def mb(n: int) -> str:
    return f'{n / MB:.2f} MB'


def problems(files: list[MediaFile]) -> list[str]:
    found = [
        f'{f.rel}: {f.size:,} bytes is over the 25 MiB ({FILE_CAP:,} bytes) Cloudflare Pages limit per file'
        for f in files if f.size > FILE_CAP
    ]
    for k, total in set_totals(files).items():
        if total > SET_CAPS[k]:
            found.append(f'{k} set: {total:,} bytes ({mb(total)}) is over its {mb(SET_CAPS[k])} budget')
    return found


def render(files: list[MediaFile]) -> list[str]:
    """The per-file table and the per-set totals, as text lines."""
    width = max([len('file'), *(len(f.rel) for f in files)])
    lines = [f'{"file":<{width}}  {"set":<7}  {"bytes":>12}', f'{"-" * width}  {"-" * 7}  {"-" * 12}']
    lines += [f'{f.rel:<{width}}  {f.klass:<7}  {f.size:>12,}' for f in files]
    lines += ['', f'{"set":<7}  {"total":>12}  {"budget":>12}  {"used":>5}  result', f'{"-" * 7}  {"-" * 12}  {"-" * 12}  {"-" * 5}  ------']
    for k, total in set_totals(files).items():
        cap = SET_CAPS[k]
        used = -(-total * 100 // cap)  # rounded up, so an overrun never shows as 100%
        lines.append(f'{k:<7}  {total:>12,}  {cap:>12,}  {used:>4}%  {"ok" if total <= cap else "OVER"}')
    return lines


def summary_markdown(files: list[MediaFile]) -> str:
    rows = ['| set | total | budget | result |', '|---|---:|---:|---|']
    for k, total in set_totals(files).items():
        rows.append(f'| {k} | {mb(total)} | {mb(SET_CAPS[k])} | {"ok" if total <= SET_CAPS[k] else "**over**"} |')
    return '### Landing media budget\n\n' + '\n'.join(rows) + '\n'


def shown(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def run(folder: Path) -> int:
    files = scan(folder)
    if not files:
        state = 'is empty' if folder.is_dir() else 'does not exist yet'
        print(f'check-media-budget: {shown(folder)} {state}; nothing to check')
        return 0
    print(f'Landing media in {shown(folder)} ({len(files)} files)\n')
    print('\n'.join(render(files)))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as fh:
            fh.write(summary_markdown(files))
    found = problems(files)
    sys.stdout.flush()  # keep the table above the error lines in CI logs
    for problem in found:
        print(f'check-media-budget: {problem}', file=sys.stderr)
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            print(f'::error title=check-media-budget::{problem}')
    return 1 if found else 0


# --------------------------------------------------------------------------
# Self-test (sparse files, so nothing large is written)
# --------------------------------------------------------------------------

def self_test() -> int:
    failures: list[str] = []
    for rel, want in [('atlas-desktop.mp4', 'desktop'), ('stills-mobile.avif', 'mobile'),
                      ('mobile/frame0.avif', 'mobile'), ('tilemap.json', 'shared'),
                      ('desktop-and-mobile.json', 'shared'), ('desktopish.mp4', 'shared')]:
        if classify(rel) != want:
            failures.append(f'classify({rel!r}) = {classify(rel)!r}, expected {want!r}')

    # (name, files or None for "no folder", expected problem substrings; [] = must pass)
    cases: list[tuple[str, dict[str, int] | None, list[str]]] = [
        ('missing folder', None, []),
        ('empty folder', {}, []),
        ('hidden files only', {'.DS_Store': 30 * MIB}, []),
        ('typical v1 set', {'atlas-desktop.mp4': 2_400_000, 'frame0-desktop.avif': 150_000,
                            'stills-desktop.avif': 400_000, 'atlas-mobile.mp4': 900_000,
                            'frame0-mobile.avif': 60_000, 'stills-mobile.avif': 150_000,
                            'tilemap.json': 4_000}, []),
        ('exactly at both caps', {'atlas-desktop.mp4': 6 * MB - 1_000, 'atlas-mobile.mp4': 2_500_000 - 1_000,
                                  'tilemap.json': 1_000}, []),
        ('desktop over by one byte', {'atlas-desktop.mp4': 6 * MB + 1}, ['desktop set']),
        ('mobile over through a shared file', {'atlas-mobile.mp4': 2 * MB, 'tilemap.json': 600_000}, ['mobile set']),
        ('class taken from a folder name', {'mobile/atlas.mp4': 2_600_000}, ['mobile set']),
        ('one file over 25 MiB', {'atlas-desktop.mp4': FILE_CAP + 1}, ['25 MiB', 'desktop set']),
    ]
    with tempfile.TemporaryDirectory(prefix='check-media-budget-') as tmp:
        for n, (name, layout, expected) in enumerate(cases):
            folder = Path(tmp) / f'case-{n}'
            if layout is not None:
                folder.mkdir()
                for rel, size in layout.items():
                    path = folder / rel
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with open(path, 'wb') as fh:
                        fh.truncate(size)
            got = problems(scan(folder))
            if not expected and got:
                failures.append(f'{name}: must pass, got {got}')
            for part in expected:
                if not any(part in p for p in got):
                    failures.append(f'{name}: expected a problem mentioning {part!r}, got {got or "none"}')
            if 'desktop set' not in expected and any('desktop set' in p for p in got):
                failures.append(f'{name}: unexpected desktop problem {got}')
    for line in failures:
        print(f'self-test FAILED: {line}', file=sys.stderr)
    if failures:
        return 1
    print(f'check-media-budget self-test: {len(cases)} layouts and the file classifier behave as expected')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Check the landing media against its byte budgets.')
    parser.add_argument('--dir', type=Path, default=MEDIA_DIR,
                        help='media folder (default: apps/web/src/landing3d/media)')
    parser.add_argument('--self-test', action='store_true', help='run the built-in tests and exit')
    args = parser.parse_args(argv)
    return self_test() if args.self_test else run(args.dir)


if __name__ == '__main__':
    sys.exit(main())
