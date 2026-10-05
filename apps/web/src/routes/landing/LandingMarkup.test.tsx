import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../../lib/i18n.ts'
import i18n from '../../lib/i18n.ts'
import { LandingMarkup } from './LandingMarkup.tsx'

const parse = (html: string) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  // Ignore whitespace-only text nodes and comments so formatting doesn't matter.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT)
  const drop: Node[] = []
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (n.nodeType === Node.COMMENT_NODE || !n.textContent?.trim()) drop.push(n)
    else n.textContent = n.textContent.replace(/\s+/g, ' ').trim()
  }
  drop.forEach((n) => n.parentNode?.removeChild(n))
  return doc.body.querySelector("[data-page=landing]")!
}

// Tag + sorted attributes + children, so attribute order and formatting don't matter.
const canonical = (el: Element): string => {
  const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ')
  const kids = [...el.childNodes].map((n) => (n.nodeType === Node.TEXT_NODE ? n.textContent : canonical(n as Element))).join('')
  return `<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${kids}</${el.tagName.toLowerCase()}>`
}

describe('landing markup parity', () => {
  it('landing.html static copy matches the React markup', async () => {
    await i18n.changeLanguage('en')
    const html = readFileSync(resolve(import.meta.dirname, '../../../landing.html'), 'utf8')
    const staticPart = /<div id="landing-static"[^>]*>([\s\S]*?)<\/div>\s*<div id="root">/.exec(html)
    expect(staticPart).not.toBeNull()
    const staticEl = parse(`<div class="landing" data-page="landing">${staticPart![1]}</div>`)
    const reactEl = parse(renderToStaticMarkup(<LandingMarkup />))
    expect(canonical(reactEl)).toBe(canonical(staticEl))
  })
})
