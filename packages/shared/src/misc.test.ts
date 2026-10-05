import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine, googleCalendarUrl } from './ics.ts'
import { displayHostname, isSafeHttpsUrl } from './links.ts'
import { errorKey } from './errors.ts'
import { imageUrl, newPosterPaths } from './images.ts'
import { checkPostTiming, postFormSchema, slugify, usernameSchema } from './schemas.ts'
import { createBrowserClient, usernameToEmail } from './supabase.ts'

const ORG = '11111111-1111-4111-8111-111111111111'

describe('ics', () => {
  const ev = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Hack night; snacks, drinks',
    startsAt: '2026-10-11T12:00:00Z',
    endsAt: '2026-10-11T14:00:00Z',
    venue: 'DK A',
    description: 'Line 1\nLine 2',
    url: 'https://forms.gle/abc',
  }

  it('escapes TEXT values', () => {
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
  })

  it('cannot be injected through CR/LF in club text', () => {
    const ics = buildIcs({ ...ev, title: 'Talk\r\nATTACH:https://evil.example/x' }, new Date('2026-10-01T00:00:00Z'))
    const lines = ics.split('\r\n')
    expect(lines.some((l) => l.startsWith('ATTACH'))).toBe(false)
    expect(lines.filter((l) => l.startsWith('SUMMARY:'))).toHaveLength(1)
  })

  it('folds long lines at 75 octets, multi-byte safe', () => {
    const folded = foldIcsLine('SUMMARY:' + 'é'.repeat(80))
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })

  it('builds a complete calendar with CRLF endings', () => {
    const ics = buildIcs(ev, new Date('2026-10-01T00:00:00Z'))
    expect(ics).toContain('DTSTART:20261011T120000Z\r\n')
    expect(ics).toContain('DTEND:20261011T140000Z\r\n')
    expect(ics).toContain('SUMMARY:Hack night\\; snacks\\, drinks\r\n')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('makes a Google Calendar link', () => {
    const u = new URL(googleCalendarUrl(ev))
    expect(u.hostname).toBe('calendar.google.com')
    expect(u.searchParams.get('dates')).toBe('20261011T120000Z/20261011T140000Z')
  })
})

describe('links', () => {
  it('accepts plain https links and shows the hostname', () => {
    expect(isSafeHttpsUrl('https://forms.gle/AbC?x=1')).toBe(true)
    expect(displayHostname('https://Docs.Google.com/forms/x')).toBe('docs.google.com')
  })

  it('rejects http, userinfo, whitespace and javascript links', () => {
    for (const bad of ['http://forms.gle/x', 'https://usm.my@evil.example/', 'https://a.b/c d', 'javascript:alert(1)', 'https://exämple.com/']) {
      expect(isSafeHttpsUrl(bad)).toBe(false)
      expect(displayHostname(bad)).toBeNull()
    }
  })
})

describe('errorKey', () => {
  it('maps trigger, constraint, privilege and auth errors', () => {
    expect(errorKey({ code: 'P0001', message: 'quota_live' })).toBe('quota_live')
    expect(errorKey({ code: 'P0001', message: 'something else' })).toBe('unknown')
    expect(errorKey({ code: '23514', message: 'new row for relation "posts" violates check constraint "posts_link_url"' })).toBe('link_format')
    expect(errorKey({ code: '42501', message: 'new row violates row-level security policy' })).toBe('not_allowed')
    expect(errorKey({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('auth_invalid')
    expect(errorKey({ code: 'captcha_failed', message: 'captcha' })).toBe('auth_captcha')
    expect(errorKey(new TypeError('Failed to fetch'))).toBe('network')
    expect(errorKey(null)).toBe('unknown')
  })
})

describe('images', () => {
  it('builds proxy and direct URLs only for valid paths', () => {
    const { poster, thumb } = newPosterPaths(ORG, 'webp', () => '33333333-3333-4333-8333-333333333333')
    expect(poster).toBe(`${ORG}/33333333-3333-4333-8333-333333333333.webp`)
    expect(thumb).toBe(`${ORG}/33333333-3333-4333-8333-333333333333-thumb.webp`)
    expect(imageUrl(thumb, 'proxy', 'https://x.supabase.co')).toBe(`/i/${thumb}`)
    expect(imageUrl(poster, 'direct', 'https://x.supabase.co/')).toBe(`https://x.supabase.co/storage/v1/object/public/posters/${poster}`)
    expect(imageUrl(`${ORG}/../evil.webp`, 'proxy', 'https://x.supabase.co')).toBeNull()
  })
})

describe('schemas', () => {
  const base = {
    title: 'Hack night',
    venue: 'DK A',
    campus: 'main',
    description: '',
    link_url: '',
    startDate: '2026-10-11',
    startTime: '20:00',
    endDate: '2026-10-11',
    endTime: '22:00',
  }

  it('turns MYT form input into ISO instants and nulls empty optionals', () => {
    const r = postFormSchema.parse(base)
    expect(r.starts_at).toBe('2026-10-11T12:00:00.000Z')
    expect(r.ends_at).toBe('2026-10-11T14:00:00.000Z')
    expect(r.description).toBeNull()
    expect(r.link_url).toBeNull()
  })

  it('rejects an end before the start and events over 31 days', () => {
    expect(postFormSchema.safeParse({ ...base, endTime: '19:00' }).success).toBe(false)
    expect(postFormSchema.safeParse({ ...base, endDate: '2026-11-20' }).success).toBe(false)
  })

  it('rejects bad links and control characters', () => {
    expect(postFormSchema.safeParse({ ...base, link_url: 'http://x.y' }).success).toBe(false)
    expect(postFormSchema.safeParse({ ...base, title: 'Bad\u0007title' }).success).toBe(false)
    expect(postFormSchema.safeParse({ ...base, description: 'two\nlines' }).success).toBe(true)
  })

  it('mirrors the trigger timing rules', () => {
    const now = new Date('2026-10-11T04:00:00Z')
    expect(checkPostTiming({ starts_at: '2026-10-11T03:00:00Z', ends_at: '2026-10-11T04:10:00Z' }, 'create', now)).toBe('end_in_past')
    expect(checkPostTiming({ starts_at: '2026-10-11T03:00:00Z', ends_at: '2026-10-11T06:00:00Z' }, 'create', now)).toBeNull()
    expect(checkPostTiming({ starts_at: '2027-11-11T03:00:00Z', ends_at: '2027-11-11T06:00:00Z' }, 'create', now)).toBe('start_too_late')
    expect(checkPostTiming({ starts_at: '2026-10-11T01:00:00Z', ends_at: '2026-10-11T06:00:00Z' }, { previousStartsAt: 'x' }, now)).toBe('start_too_early')
  })

  it('normalises usernames and slugs', () => {
    expect(usernameSchema.parse('  CSSoc ')).toBe('cssoc')
    expect(usernameSchema.safeParse('a').success).toBe(false)
    expect(slugify('Persatuan Sains Komputer (PSK) — USM!')).toBe('persatuan-sains-komputer-psk-usm')
  })
})

describe('supabase client', () => {
  it('refuses secret keys in the browser', () => {
    expect(() => createBrowserClient('http://127.0.0.1:54321', 'sb_secret_REPLACE_ME')).toThrow()
  })

  it('maps usernames to the synthetic login email', () => {
    expect(usernameToEmail(' CSSoc ')).toBe('cssoc@usmfomo.pages.dev')
  })
})
