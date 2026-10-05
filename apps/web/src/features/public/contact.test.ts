import { describe, expect, it } from 'vitest'
import { contactHref } from './contact.ts'

describe('contactHref', () => {
  it('accepts https and mailto links', () => {
    expect(contactHref('https://www.instagram.com/usmfomo.admin')).toBe('https://www.instagram.com/usmfomo.admin')
    expect(contactHref(' mailto:usmfomo.admin@gmail.com ')).toBe('mailto:usmfomo.admin@gmail.com')
  })

  it('refuses anything else, so the page falls back to plain text', () => {
    expect(contactHref('')).toBeNull()
    expect(contactHref('http://example.com')).toBeNull()
    expect(contactHref('javascript:alert(1)')).toBeNull()
    expect(contactHref('https://')).toBeNull()
    expect(contactHref('https://a.example/x y')).toBeNull()
  })
})
