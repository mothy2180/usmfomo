// @vitest-environment node
// Contrast of the design tokens in styles.css (WCAG 2.2 AA): text needs 4.5:1,
// the edges of form fields 3:1 (1.4.11) on every background they sit on.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(css)
  if (!match?.[1]) throw new Error(`token --color-${name} not found`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const BACKGROUNDS = ['ink', 'surface', 'surface-2']

describe('design tokens', () => {
  it('gives form fields a border of at least 3:1 on every background', () => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(token('field-line'), token(bg))).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses the same field border as the public site', () => {
    expect(token('field-line').toLowerCase()).toBe('#6b7790')
  })

  it('keeps body and muted text at 4.5:1 or more', () => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(token('text'), token(bg))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token('muted'), token(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
