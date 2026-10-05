"""Unit tests for the pure helpers in build-landing-atlas.py (no Docker needed).

Run: python3 -m unittest discover -s apps/web/scripts -p 'test_*.py'
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

_PATH = Path(__file__).with_name('build-landing-atlas.py')
_SPEC = importlib.util.spec_from_file_location('build_landing_atlas', _PATH)
assert _SPEC and _SPEC.loader
atlas = importlib.util.module_from_spec(_SPEC)
sys.modules['build_landing_atlas'] = atlas  # dataclasses look the module up
_SPEC.loader.exec_module(atlas)


class LayoutTests(unittest.TestCase):
    def test_xstack_layout_is_row_major_from_the_top_left(self):
        layout = atlas.xstack_layout(6, 3, 320).split('|')
        self.assertEqual(len(layout), 18)
        self.assertEqual(layout[0], '0_0')
        self.assertEqual(layout[5], '1600_0')
        self.assertEqual(layout[6], '0_320')
        self.assertEqual(layout[17], '1600_640')

    def test_classes_match_the_scene_contract(self):
        desktop, mobile = atlas.KLASSES
        self.assertEqual((desktop.width, desktop.height, desktop.still_tile), (1920, 960, 512))
        self.assertEqual((mobile.width, mobile.height, mobile.still_tile), (1152, 576, 256))
        for k in atlas.KLASSES:
            # avc1.<profile 4D = Main><constraints 40><level>, as the browser is asked.
            self.assertEqual(k.codec, f'avc1.4D40{k.level_idc:02X}')
            self.assertEqual(k.level_idc, int(float(k.level) * 10))
        self.assertLessEqual(desktop.budget, 3_000_000)
        self.assertLessEqual(mobile.budget, 1_200_000)

    def test_fill_repeats_inputs_in_order(self):
        self.assertEqual(atlas.fill(['a', 'b'], 5), ['a', 'b', 'a', 'b', 'a'])


class SyntheticMediaTests(unittest.TestCase):
    def test_eighteen_distinct_patterns_with_palettes(self):
        names = [name for name, _, _ in atlas.FIELDS]
        self.assertEqual(len(names), atlas.CLIP_TILES)
        self.assertEqual(len(set(names)), len(names))
        self.assertEqual(len(atlas.PALETTES), atlas.CLIP_TILES)
        for _, expr, gain in atlas.FIELDS:
            self.assertGreater(gain, 0)
            self.assertLessEqual(gain, 1)
            # Time only appears as whole cycles per 4 s, so every clip loops seamlessly.
            for i in range(len(expr)):
                if expr[i] == 'T' and (i == 0 or not expr[i - 1].isalpha()):
                    self.assertTrue(expr[i:i + 3] == 'T/4', expr)

    def test_palette_gain_scales_the_contrast_only(self):
        palette = atlas.PALETTES[0]
        full = atlas.palette_geq('X', palette)
        half = atlas.palette_geq('X', palette, 0.5)
        self.assertIn(f'{palette[1][0]}*cos', full)
        self.assertIn(f'{round(palette[1][0] * 0.5, 4)}*cos', half)
        self.assertIn(f'clip({palette[0][0]}+', half)

    def test_labels_are_drawn_with_boxes(self):
        filters = atlas.label_filters('18', 100, 100, 40)
        # One backing plate plus seven-segment strokes: "1" has 2, "8" has 7.
        self.assertEqual(len(filters), 1 + 2 + 7)
        self.assertTrue(all(f.startswith('drawbox=') for f in filters))


class InputTests(unittest.TestCase):
    def test_hdr_inputs_are_tone_mapped(self):
        self.assertEqual(atlas.input_prefilter({'color_transfer': 'arib-std-b67', 'pix_fmt': 'yuv420p10le'}), atlas.TONEMAP)
        self.assertEqual(atlas.input_prefilter({'color_transfer': 'smpte2084', 'pix_fmt': 'yuv420p10le'}), atlas.TONEMAP)

    def test_alpha_is_flattened_and_plain_video_left_alone(self):
        for pix in ('pal8', 'rgba', 'yuva420p', 'gbrap'):
            self.assertEqual(atlas.input_prefilter({'pix_fmt': pix}), atlas.FLATTEN_ALPHA, pix)
        for pix in ('yuv420p', 'yuvj420p', 'nv12', 'rgb24', 'gray'):
            self.assertEqual(atlas.input_prefilter({'pix_fmt': pix, 'color_transfer': 'bt709'}), '', pix)

    def test_parse_starts(self):
        self.assertEqual(atlas.parse_starts(['clip.mov=2.5', 'b.mp4=0']), {'clip.mov': 2.5, 'b.mp4': 0.0})
        with self.assertRaises(atlas.BuildError):
            atlas.parse_starts(['clip.mov'])

    def test_container_paths(self):
        self.assertEqual(atlas.container_path(atlas.RAW / 'clips' / 'a.mov'), '/m/raw/clips/a.mov')
        self.assertEqual(atlas.container_path(atlas.WORK / 'tiles' / 't.mkv'), '/m/work/tiles/t.mkv')
        self.assertEqual(atlas.container_path(atlas.DEST / 'tilemap.json'), '/dest/tilemap.json')
        with self.assertRaises(atlas.BuildError):
            atlas.container_path(Path('/etc/passwd'))


class Mp4Tests(unittest.TestCase):
    @staticmethod
    def box(kind: bytes, payload: bytes = b'') -> bytes:
        return (8 + len(payload)).to_bytes(4, 'big') + kind + payload

    def test_top_level_boxes_in_file_order(self):
        data = self.box(b'ftyp', b'isom0000') + self.box(b'moov', b'x' * 20) + self.box(b'mdat', b'y' * 100)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'a.mp4'
            path.write_bytes(data)
            self.assertEqual(atlas.mp4_boxes(path), ['ftyp', 'moov', 'mdat'])

    def test_codec_string_from_avcc(self):
        # avcC: version 1, profile 0x4D (Main), compatibility 0x40, level 0x1F (3.1).
        data = b'....avcC' + bytes([1, 0x4D, 0x40, 0x1F]) + b'rest'
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'a.mp4'
            path.write_bytes(data)
            self.assertEqual(atlas.avc_codec_string(path), 'avc1.4D401F')
            path.write_bytes(b'no codec box here')
            with self.assertRaises(atlas.BuildError):
                atlas.avc_codec_string(path)


if __name__ == '__main__':
    unittest.main()
