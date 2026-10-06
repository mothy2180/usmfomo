// The stylesheet and the two HTML pages: design tokens and document-level
// settings that no component test can see.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8')
const css = read('../styles.css')
const pages = { 'index.html': read('../../index.html'), 'landing.html': read('../../landing.html') }

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)
  if (!match?.[1]) throw new Error(`no --color-${name} in styles.css`)
  return match[1]
}

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('stylesheet', () => {
  it('field edges reach 3:1 on every background a field sits on (WCAG 1.4.11)', () => {
    for (const bg of ['ink', 'surface', 'surface-2']) {
      expect(contrast(token('field-line'), token(bg))).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps focused elements clear of the sticky header from the lg breakpoint', () => {
    expect(css).toMatch(/@media \(min-width: 64rem\) \{\s*html \{\s*scroll-padding-top: 5rem;/)
  })

  it('gives the landing header, centre and footer their own rows (the <picture> is a grid child too)', () => {
    // The top-level rule for a selector (rules inside @media are indented).
    const rule = (selector: string) => new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
    expect(rule('.landing-top')).toMatch(/grid-row: 1;/)
    expect(rule('.landing-center')).toMatch(/grid-row: 2;/)
    expect(rule('.landing-footer')).toMatch(/grid-row: 3;/)
  })
})

describe('HTML pages', () => {
  it('ask for dark native controls (date pickers, selects, scrollbars)', () => {
    expect(css).toMatch(/:root \{[^}]*color-scheme: dark;/)
    for (const html of Object.values(pages)) {
      expect(html).toContain('<meta name="color-scheme" content="dark" />')
    }
  })

  it('explain in both languages that the app needs JavaScript', () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(pages['index.html'])?.[1] ?? ''
    expect(noscript).toContain('usmfomo needs JavaScript to list events.')
    expect(noscript).toMatch(/<p lang="ms">[^<]*JavaScript[^<]*<\/p>/)
  })
})
