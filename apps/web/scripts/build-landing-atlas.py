#!/usr/bin/env python3
"""Build the landing-page media for the floating-glass scene (Module 6).

ffmpeg runs in Docker (image pinned below; nothing is installed locally), with
no network, no capabilities and a read-only root filesystem, because the
inputs are files other people sent us.

Inputs (private, git-ignored):
  media/raw/clips/*     9-18 original clips (MP4/MOV/M4V/WebM/MKV/GIF), >= 480 px,
                        subject in the centre (every tile is a centre square)
  media/raw/posters/*   4-16 posters (PNG/JPG/WebP), >= 1024 px on the short side
With --synthetic, or when a folder has no usable files, generated test
patterns (18 clips / 16 posters) are used instead. HDR clips (PQ/HLG, e.g. from
an iPhone) are tone-mapped to SDR bt709 and transparent pixels become black;
every clip and poster is scaled to its tile before xstack.

Shipped outputs (apps/web/src/landing3d/media, imported through Vite ?url):
  atlas-desktop.mp4     1920x960, 6x3 tiles of 320, H.264 Main@4.0, <= 3.5 Mb/s
  atlas-mobile.mp4      1152x576, 6x3 tiles of 192, H.264 Main@3.1, <= 1.5 Mb/s
  frame0-<class>.avif   the first frame of each atlas (WebP if AVIF is missing)
  stills-<class>.avif   posters, 4x4 tiles: 2048x2048 desktop, 1024x1024 mobile
  tilemap.json          grid geometry + codec strings read by the scene
Review outputs (never shipped): media/out/debug-*.{mp4,png} (numbered grids).
Scratch: media/work/.

Checks (any failure exits non-zero): ffmpeg's photosensitivity filter on every
clip (looped twice, so the loop seam counts; WCAG 2.3.1), ffprobe on every
output (size, fps, frame count, duration, profile/level, bt709 tags, no audio,
a single keyframe), MP4 boxes (moov before mdat = faststart; the avcC codec
string the browser is asked about), and the per-class byte budgets.

Tests for the pure helpers (no Docker):
  python3 -m unittest discover -s apps/web/scripts -p 'test_*.py'

Usage:
  python3 apps/web/scripts/build-landing-atlas.py               # real media if present
  python3 apps/web/scripts/build-landing-atlas.py --synthetic   # generated test patterns
  python3 apps/web/scripts/build-landing-atlas.py --verify-only # re-check shipped files
  ... --start clip-name.mov=2.5   use seconds 2.5-6.5 of that clip (repeatable)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

IMAGE = 'mwader/static-ffmpeg:9.0.2'

ROOT = Path(__file__).resolve().parents[3]
MEDIA = ROOT / 'media'
RAW = MEDIA / 'raw'
WORK = MEDIA / 'work'
OUT = MEDIA / 'out'
DEST = ROOT / 'apps' / 'web' / 'src' / 'landing3d' / 'media'

FPS = 24
SECONDS = 4
FRAMES = FPS * SECONDS
COLS, ROWS = 6, 3
CLIP_TILES = COLS * ROWS
STILL_COLS = STILL_ROWS = 4
POSTER_TILES = STILL_COLS * STILL_ROWS

CLIP_EXT = {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.gif'}
POSTER_EXT = {'.png', '.jpg', '.jpeg', '.webp'}

# Photosensitivity: the filter's own detection threshold is 1.0 (it would start
# blending frames). A full-frame black/white cut once a second already scores
# ~3.8, so anything at or above 1.0 is a flash or a hard bright/dark cut.
MAX_FLASH_DEFAULT = 1.0
WARN_FLASH = 0.5

# AV1 quality for the stills (lower = better). crf 32 showed banding on smooth
# gradients; these stay well inside the byte budgets.
FRAME0_CRF = 26
STILLS_CRF = 24


@dataclass(frozen=True)
class Klass:
    name: str
    tile: int
    level: str  # x264 -level
    level_idc: int  # as ffprobe reports it
    codec: str  # RFC 6381 string, must match the avcC box
    maxrate_k: int
    stills: int  # stills atlas edge
    inset_px: int
    budget: int  # bytes: video + frame0 + stills

    @property
    def width(self) -> int:
        return self.tile * COLS

    @property
    def height(self) -> int:
        return self.tile * ROWS

    @property
    def still_tile(self) -> int:
        return self.stills // STILL_COLS


KLASSES = [
    Klass('desktop', 320, '4.0', 40, 'avc1.4D4028', 3500, 2048, 4, 3_000_000),
    Klass('mobile', 192, '3.1', 31, 'avc1.4D401F', 1500, 1024, 3, 1_200_000),
]


class BuildError(Exception):
    pass


# --------------------------------------------------------------------------
# Docker / ffmpeg
# --------------------------------------------------------------------------

def container_path(p: Path) -> str:
    """Host path -> path inside the container (/m = media/, /dest = DEST)."""
    p = p.resolve()
    for host, inside in ((RAW, '/m/raw'), (MEDIA, '/m'), (DEST, '/dest')):
        try:
            rel = p.relative_to(host.resolve())
        except ValueError:
            continue
        return f'{inside}/{rel.as_posix()}' if str(rel) != '.' else inside
    raise BuildError(f'{p} is outside the mounted folders')


def docker(tool: str, args: list[str], *, capture: bool = False) -> str:
    cmd = [
        'docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--read-only',
        '--user', f'{os.getuid()}:{os.getgid()}',
        '-v', f'{MEDIA.resolve()}:/m',
        '-v', f'{RAW.resolve()}:/m/raw:ro',
        '-v', f'{DEST.resolve()}:/dest',
        '--entrypoint', f'/{tool}', IMAGE, '-hide_banner', *args,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        tail = '\n'.join((res.stderr or res.stdout).strip().splitlines()[-12:])
        raise BuildError(f'{tool} failed ({res.returncode}):\n{tail}')
    return res.stdout if capture else ''


def ffmpeg(args: list[str]) -> None:
    docker('ffmpeg', ['-v', 'error', '-y', *args])


def ffprobe_json(path: Path, extra: list[str] | None = None) -> dict:
    out = docker('ffprobe', ['-v', 'error', '-print_format', 'json', *(extra or []), container_path(path)], capture=True)
    return json.loads(out or '{}')


def encoders() -> str:
    return docker('ffmpeg', ['-encoders'], capture=True)


BT709_OUT = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
TAG_709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'


def to_tile(size: int) -> str:
    """Centre-square crop + scale to one tile, converting to bt709 yuv420p.
    Every clip/poster is scaled here, BEFORE xstack; the grid is never scaled."""
    return (
        f'scale=w={size}:h={size}:force_original_aspect_ratio=increase:flags=lanczos'
        f':out_color_matrix=bt709:out_range=tv,format=yuv420p,crop={size}:{size},setsar=1,{TAG_709}'
    )


def xstack_layout(cols: int, rows: int, tile: int) -> str:
    return '|'.join(f'{(i % cols) * tile}_{(i // cols) * tile}' for i in range(cols * rows))


# PQ/HLG input (e.g. iPhone HDR video) is tone-mapped to SDR bt709 first;
# scaling alone would leave it washed out.
HDR_TRANSFERS = {'smpte2084', 'arib-std-b67'}
TONEMAP = ('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,'
           'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p')
# Transparent pixels (GIF/PNG/WebP alpha) become black instead of whatever
# colour they happen to hide.
FLATTEN_ALPHA = 'format=rgba,premultiply=inplace=1'
ALPHA_PIX_FMTS = {'pal8', 'rgba', 'bgra', 'argb', 'abgr', 'ya8', 'ya16le', 'rgba64le', 'bgra64le'}


def has_alpha(pix_fmt: str) -> bool:
    return pix_fmt in ALPHA_PIX_FMTS or pix_fmt.startswith(('yuva', 'gbrap'))


def input_prefilter(stream: dict) -> str:
    """Filters that run before the tile scale for one probed input stream."""
    chain = []
    if stream.get('color_transfer') in HDR_TRANSFERS:
        chain.append(TONEMAP)
    elif has_alpha(str(stream.get('pix_fmt', ''))):
        chain.append(FLATTEN_ALPHA)
    return ','.join(chain)


def probe_input(src: Path) -> dict:
    info = ffprobe_json(src, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,color_transfer'])
    streams = info.get('streams') or []
    if not streams:
        raise BuildError(f'{src.name}: no video stream ffprobe can read')
    return streams[0]


# --------------------------------------------------------------------------
# Seven-segment numbers drawn with drawbox (the static ffmpeg image has no
# fonts, and this keeps the debug output deterministic)
# --------------------------------------------------------------------------

SEGMENTS = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
    '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', 'P': 'abefg',
}


def glyph_boxes(ch: str, x: int, y: int, w: int, h: int, t: int) -> list[tuple[int, int, int, int]]:
    v = (h - 3 * t) // 2
    mid = y + t + v
    rects = {
        'a': (x + t, y, w - 2 * t, t),
        'g': (x + t, mid, w - 2 * t, t),
        'd': (x + t, mid + t + v, w - 2 * t, t),
        'f': (x, y + t, t, v),
        'b': (x + w - t, y + t, t, v),
        'e': (x, mid + t, t, v),
        'c': (x + w - t, mid + t, t, v),
    }
    return [rects[s] for s in SEGMENTS[ch]]


def label_filters(text: str, cx: int, cy: int, h: int, *, color: str = 'white@0.95', plate: str = 'black@0.62') -> list[str]:
    """drawbox filters that write `text` (digits/P) centred on (cx, cy)."""
    w = max(6, int(h * 0.56))
    t = max(2, h // 8)
    gap = max(2, h // 5)
    total = len(text) * w + (len(text) - 1) * gap
    x0 = cx - total // 2
    y0 = cy - h // 2
    pad = max(3, h // 4)
    out = [f'drawbox=x={x0 - pad}:y={y0 - pad}:w={total + 2 * pad}:h={h + 2 * pad}:color={plate}:t=fill']
    for i, ch in enumerate(text):
        for (bx, by, bw, bh) in glyph_boxes(ch, x0 + i * (w + gap), y0, w, h, t):
            out.append(f'drawbox=x={bx}:y={by}:w={bw}:h={bh}:color={color}:t=fill')
    return out


# --------------------------------------------------------------------------
# Synthetic dev media: calm, seamlessly looping (period = 4 s) test patterns
# --------------------------------------------------------------------------

SYN = 480  # synthetic clip edge: like a real >= 480 px clip, so it takes the same path
SYN_POSTER = 1024

# Scalar fields v(X, Y, T) in about [0, 1]. Every time term completes whole
# cycles in 4 s (2*PI*T/4), so each clip loops without a seam. Motion is slow
# and smooth: no flashes, no hard cuts.
#
# The third value scales the palette contrast. ffmpeg's photosensitivity score
# adds up colour changes of an 8x8 grid of cell averages over 30 frames, so
# broad patterns (whole cells changing together) score high even when they move
# slowly; those get less contrast. With these values every clip scores < 0.45.
C = SYN / 2
R = f'hypot(X-{C},Y-{C})'
A = f'atan2(Y-{C},X-{C})'
FIELDS: list[tuple[str, str, float]] = [
    ('stripes', f'0.5+0.5*sin(2*PI*((X*0.80+Y*0.60)/150-T/4))', 1.0),
    ('rings', f'0.5+0.5*sin(2*PI*({R}/120-T/4))', 1.0),
    ('spiral', f'0.5+0.5*sin(3*{A}+2*PI*({R}/160-T/4))', 1.0),
    ('rays', f'0.5+0.5*sin(6*{A}-2*PI*T/4)', 1.0),
    ('checker', '0.5+0.5*sin(2*PI*(X/160-T/4))*sin(2*PI*Y/160)', 1.0),
    ('plasma', '0.5+0.25*sin(2*PI*(X/220-T/4))+0.25*sin(2*PI*((X+Y)/300+T/4))', 1.0),
    ('orbit', f'clip(9000/(pow(X-{C}-120*cos(2*PI*T/4),2)+pow(Y-{C}-120*sin(2*PI*T/4),2)+9000)'
              f'+9000/(pow(X-{C}+120*cos(2*PI*T/4),2)+pow(Y-{C}+120*sin(2*PI*T/4),2)+9000),0,1)', 0.6),
    ('tunnel', f'0.5+0.5*sin(2*PI*(9000/({R}+60)/75+T/4))*sin(8*{A})', 0.8),
    ('diamond', f'0.5+0.5*sin(2*PI*((abs(X-{C})+abs(Y-{C}))/170-T/4))', 1.0),
    ('weave', '0.5+0.25*sin(2*PI*(X/180+T/4))+0.25*sin(2*PI*(Y/180-T/4))', 1.0),
    ('zigzag', '0.5+0.5*sin(2*PI*(Y/150+0.12*sin(2*PI*X/160)-T/4))', 1.0),
    ('petals', f'0.5+0.5*sin(5*{A}+0.6*sin(2*PI*T/4))*cos(2*PI*{R}/260)', 1.0),
    ('ripple', f'0.5+0.5*sin(2*PI*({R}/110+0.35*sin(2*PI*T/4)))', 1.0),
    ('dunes', '0.5+0.5*sin(2*PI*((X+60*sin(2*PI*Y/300))/170-T/4))', 1.0),
    ('lens', f'clip(1.3-{R}/(170+40*sin(2*PI*T/4)),0,1)', 1.0),
    ('tiles', '0.5+0.5*sin(2*PI*((X+Y)/200-T/4))*sin(2*PI*((X-Y)/200))', 1.0),
    ('waves', '0.5+0.5*sin(2*PI*(X/170+0.25*sin(2*PI*(Y/240-T/4))))', 1.0),
    ('halo', f'0.5+0.5*cos(2*PI*({R}/200-T/4))*sin(2*{A}+2*PI*T/4)', 0.55),
]

# Cosine palettes (Inigo Quilez): rgb = a + b*cos(2*PI*(c*v + d)). Dark-ish, so
# the glass stays readable behind white text; each clip gets its own.
PALETTES = [
    ((0.42, 0.40, 0.48), (0.30, 0.30, 0.32), (1.0, 1.0, 1.0), (0.00, 0.33, 0.67)),
    ((0.45, 0.35, 0.25), (0.30, 0.25, 0.20), (1.0, 1.0, 1.0), (0.00, 0.10, 0.20)),
    ((0.30, 0.38, 0.50), (0.25, 0.30, 0.32), (1.0, 1.0, 1.0), (0.30, 0.20, 0.20)),
    ((0.40, 0.42, 0.30), (0.30, 0.28, 0.20), (1.0, 1.0, 0.5), (0.80, 0.90, 0.30)),
    ((0.42, 0.30, 0.45), (0.30, 0.22, 0.30), (1.0, 0.7, 0.4), (0.00, 0.15, 0.20)),
    ((0.30, 0.45, 0.42), (0.22, 0.30, 0.28), (2.0, 1.0, 0.0), (0.50, 0.20, 0.25)),
    ((0.50, 0.40, 0.30), (0.30, 0.30, 0.25), (1.0, 1.0, 1.0), (0.10, 0.20, 0.30)),
    ((0.28, 0.32, 0.48), (0.22, 0.25, 0.30), (1.0, 1.0, 1.0), (0.60, 0.70, 0.80)),
    ((0.48, 0.32, 0.36), (0.30, 0.22, 0.24), (1.0, 1.0, 1.0), (0.00, 0.25, 0.25)),
    ((0.35, 0.45, 0.35), (0.25, 0.30, 0.22), (1.0, 1.0, 1.0), (0.40, 0.50, 0.60)),
    ((0.45, 0.40, 0.50), (0.28, 0.30, 0.32), (0.5, 1.0, 1.0), (0.70, 0.40, 0.10)),
    ((0.40, 0.30, 0.25), (0.30, 0.22, 0.18), (1.0, 1.0, 1.0), (0.95, 0.10, 0.25)),
    ((0.30, 0.40, 0.45), (0.22, 0.30, 0.32), (1.0, 1.0, 1.0), (0.15, 0.40, 0.55)),
    ((0.45, 0.42, 0.30), (0.30, 0.30, 0.20), (1.0, 1.0, 1.0), (0.00, 0.05, 0.40)),
    ((0.38, 0.30, 0.48), (0.25, 0.22, 0.32), (1.0, 1.0, 1.0), (0.80, 0.60, 0.40)),
    ((0.32, 0.46, 0.40), (0.22, 0.32, 0.26), (1.0, 1.0, 1.0), (0.25, 0.10, 0.55)),
    ((0.46, 0.36, 0.42), (0.30, 0.26, 0.30), (1.0, 2.0, 1.0), (0.10, 0.30, 0.60)),
    ((0.36, 0.40, 0.46), (0.26, 0.28, 0.34), (1.0, 1.0, 1.0), (0.45, 0.55, 0.65)),
]


def palette_geq(field: str, palette: tuple, gain: float = 1.0) -> str:
    a, b, c, d = palette
    chans = []
    for i, ch in enumerate('rgb'):
        chans.append(f"{ch}='255*clip({a[i]}+{round(b[i] * gain, 4)}*cos(2*PI*({c[i]}*({field})+{d[i]})),0,1)'")
    return 'geq=' + ':'.join(chans)


def synthetic_clip(index: int, dest: Path) -> None:
    name, field, gain = FIELDS[index]
    label = label_filters(str(index + 1), SYN // 2, SYN // 2, 64)
    graph = ','.join([f'color=c=black:s={SYN}x{SYN}:r={FPS}:d={SECONDS}', 'format=gbrp',
                      palette_geq(field, PALETTES[index], gain), *label])
    ffmpeg(['-f', 'lavfi', '-i', graph, '-frames:v', str(FRAMES), '-c:v', 'ffv1', '-pix_fmt', 'gbrp',
            '-metadata', f'title=synthetic clip {index + 1} ({name})', container_path(dest)])


def synthetic_poster(index: int, dest: Path) -> None:
    # Static patterns (T = 0) with a different palette offset, a frame and "P<n>".
    _, field, _ = FIELDS[(index * 7 + 3) % len(FIELDS)]
    a, b, c, d = PALETTES[(index * 5 + 2) % len(PALETTES)]
    palette = (a, b, c, tuple((x + 0.5) % 1.0 for x in d))
    s = SYN_POSTER
    scaled = field.replace('X', f'(X*{SYN}/{s})').replace('Y', f'(Y*{SYN}/{s})')
    graph = ','.join([
        f'color=c=black:s={s}x{s}:r=1:d=1', 'format=gbrp', palette_geq(scaled, palette),
        f'drawbox=x=0:y=0:w={s}:h={s}:color=white@0.85:t={s // 40}',
        *label_filters(f'P{index + 1}', s // 2, s // 2, 150),
    ])
    ffmpeg(['-f', 'lavfi', '-i', graph, '-frames:v', '1', '-update', '1', container_path(dest)])


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------

def list_inputs(folder: Path, exts: set[str]) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts and not p.name.startswith('.'))


def fill(sources: list[Path], count: int) -> list[Path]:
    """Repeat the inputs in order until every tile has one."""
    return [sources[i % len(sources)] for i in range(count)]


def run_parallel(jobs: list, workers: int) -> None:
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for fut in [pool.submit(fn, *args) for fn, *args in jobs]:
            fut.result()


# --------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------

def normalize_tile(src: Path, size: int, start: float, dest: Path, prefilter: str = '') -> None:
    """One clip -> one 4 s, 24 fps, size x size bt709 tile (lossless FFV1)."""
    chain = ','.join(f for f in (f'fps={FPS}', prefilter, to_tile(size), f'trim=duration={SECONDS}', 'setpts=PTS-STARTPTS') if f)
    ffmpeg([
        '-ss', f'{start:.3f}', '-stream_loop', '-1', '-t', str(SECONDS + 1), '-i', container_path(src),
        '-vf', chain, '-frames:v', str(FRAMES), '-an', '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', *BT709_OUT, container_path(dest),
    ])


def flash_score(tile: Path, report: Path) -> float:
    """Max photosensitivity badness (relative to the filter's threshold).

    The filter compares the very first frame with an all-black history, which
    scores any colourful clip as a flash for its first 30-frame window. So the
    tile is played three times and only the 2nd and 3rd plays are scored; they
    still contain the loop seam (last frame -> first frame) twice."""
    ffmpeg(['-stream_loop', '2', '-i', container_path(tile),
            '-vf', f'photosensitivity=bypass=1,metadata=mode=print:key=lavfi.photosensitivity.badness:file={container_path(report)}',
            '-f', 'null', '-'])
    values = [float(m.group(1)) for line in report.read_text().splitlines()
              if (m := re.match(r'lavfi\.photosensitivity\.badness=([0-9.]+)', line.strip()))]
    if len(values) < 3 * FRAMES:
        raise BuildError(f'photosensitivity: only {len(values)} frames measured for {tile.name}')
    return max(values[FRAMES:])


def encode_atlas(k: Klass, tiles: list[Path], dest: Path) -> None:
    inputs: list[str] = []
    for t in tiles:
        inputs += ['-i', container_path(t)]
    pads = ''.join(f'[{i}:v]' for i in range(len(tiles)))
    graph = f'{pads}xstack=inputs={len(tiles)}:layout={xstack_layout(COLS, ROWS, k.tile)}:fill=black,{TAG_709}[v]'
    ffmpeg([
        *inputs, '-filter_complex', graph, '-map', '[v]', '-an', '-sn', '-dn', '-map_metadata', '-1',
        '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'main', '-level:v', k.level,
        '-crf', '23', '-maxrate', f'{k.maxrate_k}k', '-bufsize', f'{k.maxrate_k * 2}k',
        # One keyframe, at the start: 96 frames, GOP 96, no scene-cut keyframes.
        '-g', str(FRAMES), '-keyint_min', str(FRAMES), '-sc_threshold', '0', '-bf', '2',
        '-pix_fmt', 'yuv420p', *BT709_OUT, '-r', str(FPS), '-frames:v', str(FRAMES),
        '-fflags', '+bitexact', '-movflags', '+faststart', container_path(dest),
    ])


def still_codec_args(fmt: str, crf: int) -> list[str]:
    if fmt == 'avif':
        return ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', str(crf), '-b:v', '0', '-cpu-used', '4',
                '-row-mt', '1', '-pix_fmt', 'yuv420p', *BT709_OUT]
    # Lossy WebP is always BT.601 internally: hand libwebp RGB (converted from
    # our bt709-tagged frames) and let it do its own conversion.
    return ['-c:v', 'libwebp', '-pix_fmt', 'bgra', '-quality', '82', '-compression_level', '6']


def encode_frame0(atlas: Path, fmt: str, dest: Path) -> None:
    ffmpeg(['-i', container_path(atlas), '-frames:v', '1', '-map_metadata', '-1', *still_codec_args(fmt, FRAME0_CRF), container_path(dest)])


def encode_stills(k: Klass, posters: list[Path], fmt: str, dest: Path) -> None:
    inputs: list[str] = []
    for p in posters:
        inputs += ['-i', container_path(p)]
    chains = ''.join(f'[{i}:v]{FLATTEN_ALPHA},{to_tile(k.still_tile)}[p{i}];' for i in range(len(posters)))
    pads = ''.join(f'[p{i}]' for i in range(len(posters)))
    graph = f'{chains}{pads}xstack=inputs={len(posters)}:layout={xstack_layout(STILL_COLS, STILL_ROWS, k.still_tile)}:fill=black[v]'
    ffmpeg([*inputs, '-filter_complex', graph, '-map', '[v]', '-frames:v', '1', '-map_metadata', '-1',
            *still_codec_args(fmt, STILLS_CRF), container_path(dest)])


def debug_outputs(k: Klass, atlas: Path, stills: Path, labels: list[str]) -> list[Path]:
    """Numbered grids for review (tile n = clip n in the console table)."""
    num = []
    for i in range(CLIP_TILES):
        x, y = (i % COLS) * k.tile, (i // COLS) * k.tile
        num += label_filters(str(i + 1), x + 34, y + 30, 28, color='yellow@0.95', plate='black@0.7')
    grid = f'drawgrid=w={k.tile}:h={k.tile}:t=2:c=white@0.8'
    vf = ','.join([grid, *num])
    mp4 = OUT / f'debug-grid-{k.name}.mp4'
    png = OUT / f'debug-grid-{k.name}.png'
    ffmpeg(['-i', container_path(atlas), '-vf', vf, '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', container_path(mp4)])
    ffmpeg(['-i', container_path(atlas), '-vf', vf, '-frames:v', '1', '-update', '1', container_path(png)])
    snum = []
    st = k.still_tile
    for i in range(POSTER_TILES):
        x, y = (i % STILL_COLS) * st, (i // STILL_COLS) * st
        snum += label_filters(f'P{i + 1}', x + 60, y + 40, 40, color='yellow@0.95', plate='black@0.7')
    spng = OUT / f'debug-stills-{k.name}.png'
    ffmpeg(['-i', container_path(stills), '-vf', ','.join([f'drawgrid=w={st}:h={st}:t=3:c=white@0.8', *snum]),
            '-frames:v', '1', '-update', '1', container_path(spng)])
    (OUT / 'tiles.txt').write_text('\n'.join(labels) + '\n')
    return [mp4, png, spng]


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------

def mp4_boxes(path: Path) -> list[str]:
    """Top-level MP4 box types in file order."""
    boxes = []
    with path.open('rb') as f:
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            size = int.from_bytes(head[:4], 'big')
            kind = head[4:8].decode('latin-1')
            header = 8
            if size == 1:
                size = int.from_bytes(f.read(8), 'big')
                header = 16
            elif size == 0:
                boxes.append(kind)
                break
            boxes.append(kind)
            f.seek(size - header, os.SEEK_CUR)
    return boxes


def avc_codec_string(path: Path) -> str:
    data = path.read_bytes()
    i = data.find(b'avcC')
    if i < 0 or len(data) < i + 8:
        raise BuildError(f'{path.name}: no avcC box')
    profile, compat, level = data[i + 5], data[i + 6], data[i + 7]
    return f'avc1.{profile:02X}{compat:02X}{level:02X}'


def verify_video(k: Klass, path: Path) -> list[str]:
    errors: list[str] = []
    info = ffprobe_json(path, ['-show_format', '-show_streams'])
    streams = info.get('streams', [])
    video = [s for s in streams if s.get('codec_type') == 'video']
    if len(video) != 1:
        return [f'{path.name}: expected one video stream, found {len(video)}']
    if any(s.get('codec_type') == 'audio' for s in streams):
        errors.append(f'{path.name}: has an audio stream')
    v = video[0]
    expect = {
        'codec_name': 'h264', 'profile': 'Main', 'level': k.level_idc, 'width': k.width, 'height': k.height,
        'r_frame_rate': f'{FPS}/1', 'pix_fmt': 'yuv420p', 'color_space': 'bt709', 'color_transfer': 'bt709',
        'color_primaries': 'bt709', 'nb_frames': str(FRAMES),
    }
    for key, want in expect.items():
        if v.get(key) != want:
            errors.append(f'{path.name}: {key} = {v.get(key)!r}, expected {want!r}')
    duration = float(info.get('format', {}).get('duration', 0))
    if abs(duration - SECONDS) > 0.5 / FPS:
        errors.append(f'{path.name}: duration {duration:.3f} s, expected {SECONDS} s')
    packets = docker('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=flags',
                                 '-of', 'csv=p=0', container_path(path)], capture=True).split()
    keys = [i for i, flags in enumerate(packets) if 'K' in flags]
    if keys != [0]:
        errors.append(f'{path.name}: keyframes at packets {keys[:6]}, expected only [0]')
    boxes = mp4_boxes(path)
    if 'moov' not in boxes or 'mdat' not in boxes or boxes.index('moov') > boxes.index('mdat'):
        errors.append(f'{path.name}: moov is not before mdat (no faststart): {boxes}')
    codec = avc_codec_string(path)
    if codec != k.codec:
        errors.append(f'{path.name}: avcC says {codec}, the scene asks the browser about {k.codec}')
    bitrate = path.stat().st_size * 8 / SECONDS
    if bitrate > k.maxrate_k * 1000 * 1.05:
        errors.append(f'{path.name}: {bitrate / 1e6:.2f} Mb/s average, cap {k.maxrate_k / 1000} Mb/s')
    return errors


def verify_image(path: Path, width: int, height: int) -> list[str]:
    info = ffprobe_json(path, ['-show_streams'])
    v = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
    if not v:
        return [f'{path.name}: not an image ffprobe can read']
    if (v.get('width'), v.get('height')) != (width, height):
        return [f'{path.name}: {v.get("width")}x{v.get("height")}, expected {width}x{height}']
    return []


def outputs_for(k: Klass, fmt: str) -> dict[str, Path]:
    return {
        'video': DEST / f'atlas-{k.name}.mp4',
        'frame0': DEST / f'frame0-{k.name}.{fmt}',
        'stills': DEST / f'stills-{k.name}.{fmt}',
    }


def verify_all(fmt: str) -> tuple[list[str], dict[str, dict[str, int]]]:
    errors: list[str] = []
    sizes: dict[str, dict[str, int]] = {}
    for k in KLASSES:
        files = outputs_for(k, fmt)
        missing = [p.name for p in files.values() if not p.is_file()]
        if missing:
            errors.append(f'{k.name}: missing {", ".join(missing)}')
            continue
        errors += verify_video(k, files['video'])
        errors += verify_image(files['frame0'], k.width, k.height)
        errors += verify_image(files['stills'], k.stills, k.stills)
        sizes[k.name] = {name: p.stat().st_size for name, p in files.items()}
        total = sum(sizes[k.name].values())
        if total > k.budget:
            errors.append(f'{k.name}: {total:,} bytes shipped, budget {k.budget:,}')
    return errors, sizes


# --------------------------------------------------------------------------
# tilemap.json
# --------------------------------------------------------------------------

def write_tilemap(fmt: str, sizes: dict[str, dict[str, int]], synthetic: dict[str, bool],
                  clip_inputs: list[int], poster_inputs: list[int], flashes: list[float]) -> None:
    video, stills = {}, {}
    for k in KLASSES:
        s = sizes[k.name]
        video[k.name] = {
            'file': f'atlas-{k.name}.mp4', 'frame0': f'frame0-{k.name}.{fmt}',
            'width': k.width, 'height': k.height, 'cols': COLS, 'rows': ROWS, 'tile': k.tile,
            'insetPx': k.inset_px, 'codec': k.codec, 'maxBitrate': k.maxrate_k * 1000,
            'bytes': s['video'], 'frame0Bytes': s['frame0'],
        }
        stills[k.name] = {
            'file': f'stills-{k.name}.{fmt}', 'width': k.stills, 'height': k.stills,
            'cols': STILL_COLS, 'rows': STILL_ROWS, 'tile': k.still_tile, 'insetPx': k.inset_px, 'bytes': s['stills'],
        }
    tilemap = {
        'version': 1,
        'note': 'Generated by apps/web/scripts/build-landing-atlas.py. Tiles are numbered row-major from the top-left.',
        'synthetic': synthetic,
        'fps': FPS,
        'seconds': SECONDS,
        'video': video,
        'stills': stills,
        'clips': [{'tile': i, 'input': clip_inputs[i] + 1, 'flash': round(flashes[i], 3)} for i in range(CLIP_TILES)],
        'posters': [{'tile': i, 'input': poster_inputs[i] + 1} for i in range(POSTER_TILES)],
        'totals': {k.name: sum(sizes[k.name].values()) for k in KLASSES},
    }
    (DEST / 'tilemap.json').write_text(json.dumps(tilemap, indent=2) + '\n')


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def parse_starts(values: list[str]) -> dict[str, float]:
    starts = {}
    for v in values:
        name, sep, sec = v.partition('=')
        if not sep:
            raise BuildError(f'--start expects NAME=SECONDS, got {v!r}')
        starts[name] = float(sec)
    return starts


MIN_CLIP_EDGE, GOOD_CLIP_EDGE, MIN_POSTER_EDGE = 320, 480, 1024


def probe_inputs(clips: list[Path], posters: list[Path], synthetic: dict[str, bool], workers: int) -> dict[Path, str]:
    """Probe real inputs: per-clip prefilters (HDR tone-mapping, alpha) and
    size checks from the media checklist (clips >= 480 px, min 320; posters
    >= 1024 px on the short side)."""
    real = ([] if synthetic['clips'] else clips) + ([] if synthetic['posters'] else posters)
    if not real:
        return {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        probes = dict(zip(real, pool.map(probe_input, real)))
    prefilters: dict[Path, str] = {}
    too_small: list[str] = []
    for path, stream in probes.items():
        w, h = int(stream.get('width') or 0), int(stream.get('height') or 0)
        short = min(w, h)
        if path in clips:
            prefilters[path] = input_prefilter(stream)
            if TONEMAP in prefilters[path]:
                print(f'note: {path.name} is HDR ({stream.get("color_transfer")}); tone-mapping it to SDR')
            if short < MIN_CLIP_EDGE:
                too_small.append(f'{path.name} ({w}x{h}, clips need >= {MIN_CLIP_EDGE} px)')
            elif short < GOOD_CLIP_EDGE:
                print(f'warning: {path.name} is {w}x{h}; >= {GOOD_CLIP_EDGE} px looks sharper')
        elif short < MIN_POSTER_EDGE:
            print(f'warning: {path.name} is {w}x{h}; posters should be >= {MIN_POSTER_EDGE} px on the short side')
    if too_small:
        raise BuildError('inputs too small: ' + '; '.join(too_small))
    return prefilters


def build(args: argparse.Namespace) -> int:
    for d in (RAW / 'clips', RAW / 'posters', WORK, OUT, DEST):
        d.mkdir(parents=True, exist_ok=True)
    have_avif = 'libaom-av1' in encoders()
    fmt = 'avif' if have_avif else 'webp'
    print(f'ffmpeg image {IMAGE}; stills format: {fmt}')

    if args.verify_only:
        tm_path = DEST / 'tilemap.json'
        if tm_path.is_file():
            fmt = Path(json.loads(tm_path.read_text())['stills']['desktop']['file']).suffix.lstrip('.')
        errors, sizes = verify_all(fmt)
        report_sizes(sizes)
        return report_errors(errors)

    starts = parse_starts(args.start)
    clips = [] if args.synthetic else list_inputs(RAW / 'clips', CLIP_EXT)
    posters = [] if args.synthetic else list_inputs(RAW / 'posters', POSTER_EXT)
    if len(clips) > CLIP_TILES or len(posters) > POSTER_TILES:
        raise BuildError(f'at most {CLIP_TILES} clips and {POSTER_TILES} posters (got {len(clips)} / {len(posters)})')
    if clips and len(clips) < 9:
        print(f'warning: {len(clips)} clips; 9-18 look best (tiles repeat clips)')
    if posters and len(posters) < 4:
        print(f'warning: {len(posters)} posters; 4-16 look best')
    synthetic = {'clips': not clips, 'posters': not posters}

    syn_dir = WORK / 'synthetic'
    syn_dir.mkdir(parents=True, exist_ok=True)
    jobs: list = []
    if not clips:
        clips = [syn_dir / f'clip-{i + 1:02d}.mkv' for i in range(CLIP_TILES)]
        jobs += [(synthetic_clip, i, p) for i, p in enumerate(clips)]
    if not posters:
        posters = [syn_dir / f'poster-{i + 1:02d}.png' for i in range(POSTER_TILES)]
        jobs += [(synthetic_poster, i, p) for i, p in enumerate(posters)]
    if jobs:
        print(f'generating {len(jobs)} synthetic test patterns ...')
        run_parallel(jobs, args.jobs)

    unknown = set(starts) - {p.name for p in clips}
    if unknown:
        raise BuildError(f'--start names no clip: {", ".join(sorted(unknown))}')

    prefilters = probe_inputs(clips, posters, synthetic, args.jobs)

    clip_tiles = fill(clips, CLIP_TILES)
    poster_tiles = fill(posters, POSTER_TILES)
    clip_inputs = [clips.index(p) for p in clip_tiles]
    poster_inputs = [posters.index(p) for p in poster_tiles]

    print('normalising clips into tiles ...')
    tile_paths: dict[str, list[Path]] = {}
    jobs = []
    for k in KLASSES:
        tdir = WORK / 'tiles' / k.name
        tdir.mkdir(parents=True, exist_ok=True)
        tile_paths[k.name] = [tdir / f'tile-{i + 1:02d}.mkv' for i in range(CLIP_TILES)]
        jobs += [(normalize_tile, src, k.tile, starts.get(src.name, 0.0), dst, prefilters.get(src, ''))
                 for src, dst in zip(clip_tiles, tile_paths[k.name])]
    run_parallel(jobs, args.jobs)

    print('photosensitivity check (each clip looped twice) ...')
    ps_dir = WORK / 'photosensitivity'
    ps_dir.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        flashes = list(pool.map(lambda i: flash_score(tile_paths['desktop'][i], ps_dir / f'tile-{i + 1:02d}.txt'), range(CLIP_TILES)))
    labels = []
    for i, score in enumerate(flashes):
        src = clip_tiles[i]
        name = src.name if not synthetic['clips'] else f'synthetic {FIELDS[i][0]}'
        mark = 'FAIL' if score >= args.max_flash else ('warn' if score >= WARN_FLASH else 'ok')
        labels.append(f'tile {i + 1:2d}  {name:<32}  flash {score:6.3f}  {mark}')
        print('  ' + labels[-1])
    bad = [i + 1 for i, s in enumerate(flashes) if s >= args.max_flash]
    if bad:
        raise BuildError(f'photosensitivity: tiles {bad} score >= {args.max_flash} (flashes or hard bright/dark cuts). '
                         'Replace or trim those clips; see media/out/debug-grid-desktop.mp4')

    print('encoding atlases, frame-0 and stills ...')
    for k in KLASSES:
        files = outputs_for(k, fmt)
        encode_atlas(k, tile_paths[k.name], files['video'])
    run_parallel([(encode_frame0, outputs_for(k, fmt)['video'], fmt, outputs_for(k, fmt)['frame0']) for k in KLASSES]
                 + [(encode_stills, k, poster_tiles, fmt, outputs_for(k, fmt)['stills']) for k in KLASSES], args.jobs)
    # Remove stills of the other format so only one set ships.
    other = 'webp' if fmt == 'avif' else 'avif'
    for k in KLASSES:
        for kind in ('frame0', 'stills'):
            stale = DEST / f'{kind}-{k.name}.{other}'
            if stale.exists():
                stale.unlink()

    print('debug grids (media/out, not shipped) ...')
    for i, p in enumerate(poster_tiles):
        name = p.name if not synthetic['posters'] else 'synthetic poster'
        labels.append(f'poster P{i + 1:<2d} {name}')
    debug = debug_outputs(KLASSES[0], outputs_for(KLASSES[0], fmt)['video'], outputs_for(KLASSES[0], fmt)['stills'], labels)

    print('verifying outputs with ffprobe ...')
    errors, sizes = verify_all(fmt)
    report_sizes(sizes)
    if not errors:
        write_tilemap(fmt, sizes, synthetic, clip_inputs, poster_inputs, flashes)
        print(f'wrote {DEST / "tilemap.json"}')
        for p in debug:
            print(f'review: {p.relative_to(ROOT)}')
        if not args.keep_work:
            shutil.rmtree(WORK / 'tiles', ignore_errors=True)
    return report_errors(errors)


def report_sizes(sizes: dict[str, dict[str, int]]) -> None:
    for k in KLASSES:
        s = sizes.get(k.name)
        if not s:
            continue
        total = sum(s.values())
        parts = ', '.join(f'{name} {n / 1024:.0f} KiB' for name, n in s.items())
        print(f'  {k.name:<8} {parts}; total {total / 1e6:.2f} MB of {k.budget / 1e6:.1f} MB')


def report_errors(errors: list[str]) -> int:
    for e in errors:
        print(f'error: {e}', file=sys.stderr)
    if not errors:
        print('all checks passed')
    return 1 if errors else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--synthetic', action='store_true', help='ignore media/raw and use generated test patterns')
    ap.add_argument('--verify-only', action='store_true', help='only re-check the shipped files (ffprobe, boxes, budgets)')
    ap.add_argument('--max-flash', type=float, default=MAX_FLASH_DEFAULT,
                    help=f'fail when a clip scores at least this (default {MAX_FLASH_DEFAULT})')
    ap.add_argument('--start', action='append', default=[], metavar='NAME=SECONDS',
                    help='start offset for one clip (its 4 s window)')
    ap.add_argument('--jobs', type=int, default=max(1, min(6, (os.cpu_count() or 2) // 2)),
                    help='parallel ffmpeg containers')
    ap.add_argument('--keep-work', action='store_true', help='keep media/work/tiles for inspection')
    args = ap.parse_args()
    if shutil.which('docker') is None:
        print('error: docker is required (ffmpeg runs in the pinned image)', file=sys.stderr)
        return 2
    try:
        return build(args)
    except BuildError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
