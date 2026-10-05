// Small pure helpers: idle timeout, TOTP input, public site links, form errors.
import { describe, expect, it } from 'vitest'
import { sectionFromHash } from '../console/sections.ts'
import { fieldErrors, firstInvalid } from './forms.ts'
import { IDLE_LIMIT_MS, IDLE_WARNING_MS, formatCountdown, idlePhase } from './idle.ts'
import { DEFAULT_PUBLIC_SITE_URL, publicEventUrl, publicLoginUrl, publicOrgUrl, publicSiteUrl } from './siteUrl.ts'
import { groupSecret, isOtpauthUri, isSixDigitCode, isSvgDataUri, normaliseCode, validateDeviceName } from './totp.ts'

describe('idle timeout', () => {
  it('signs out after 30 minutes and warns 2 minutes before', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * 60_000)
    expect(idlePhase(0)).toBe('active')
    expect(idlePhase(IDLE_LIMIT_MS - IDLE_WARNING_MS - 1)).toBe('active')
    expect(idlePhase(IDLE_LIMIT_MS - IDLE_WARNING_MS)).toBe('warning')
    expect(idlePhase(IDLE_LIMIT_MS - 1)).toBe('warning')
    expect(idlePhase(IDLE_LIMIT_MS)).toBe('expired')
  })

  it('formats the countdown', () => {
    expect(formatCountdown(120_000)).toBe('2:00')
    expect(formatCountdown(65_000)).toBe('1:05')
    expect(formatCountdown(400)).toBe('0:01')
    expect(formatCountdown(-5)).toBe('0:00')
  })
})

describe('TOTP helpers', () => {
  it('normalises typed codes', () => {
    expect(normaliseCode(' 123 456 ')).toBe('123456')
    expect(normaliseCode('123-456')).toBe('123456')
    expect(isSixDigitCode('123456')).toBe(true)
    expect(isSixDigitCode('12345')).toBe(false)
    expect(isSixDigitCode('12345a')).toBe(false)
  })

  it('only links otpauth://totp URIs and only shows SVG data URIs', () => {
    expect(isOtpauthUri('otpauth://totp/usmfomo:owner?secret=ABC&issuer=usmfomo')).toBe(true)
    expect(isOtpauthUri('javascript:alert(1)')).toBe(false)
    expect(isOtpauthUri('https://evil.example/otpauth://totp/x')).toBe(false)
    expect(isSvgDataUri('data:image/svg+xml;utf-8,<svg/>')).toBe(true)
    expect(isSvgDataUri('https://evil.example/qr.svg')).toBe(false)
  })

  it('groups the setup key and validates device names', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(validateDeviceName('  ', [])).toMatch(/Give the device a name/)
    expect(validateDeviceName('Phone', ['phone'])).toMatch(/already have a device/)
    expect(validateDeviceName('x'.repeat(41), [])).toMatch(/at most 40/)
    expect(validateDeviceName('Backup phone', ['Phone'])).toBeNull()
  })
})

describe('public site links', () => {
  it('defaults to the production site and normalises the env value', () => {
    expect(publicSiteUrl(undefined)).toBe(DEFAULT_PUBLIC_SITE_URL)
    expect(publicSiteUrl('  ')).toBe(DEFAULT_PUBLIC_SITE_URL)
    expect(publicSiteUrl('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173')
    expect(publicSiteUrl('https://preview.usmfomo.pages.dev/base//')).toBe('https://preview.usmfomo.pages.dev/base')
    expect(publicSiteUrl('javascript:alert(1)')).toBe(DEFAULT_PUBLIC_SITE_URL)
    expect(publicSiteUrl('https://user:pw@evil.example')).toBe(DEFAULT_PUBLIC_SITE_URL)
    expect(publicSiteUrl('not a url')).toBe(DEFAULT_PUBLIC_SITE_URL)
  })

  it('builds event, organiser and login links', () => {
    const id = '0e5b8a1c-1111-4c2d-9e3f-123456789abc'
    expect(publicEventUrl(DEFAULT_PUBLIC_SITE_URL, id)).toBe(`https://usmfomo.pages.dev/e/${id}`)
    expect(publicOrgUrl(DEFAULT_PUBLIC_SITE_URL, 'robotics-club')).toBe('https://usmfomo.pages.dev/o/robotics-club')
    expect(publicLoginUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/login')
  })
})

describe('console sections', () => {
  it('reads the section from the hash and ignores unknown hashes', () => {
    expect(sectionFromHash('#accounts')).toBe('accounts')
    expect(sectionFromHash('#/notices')).toBe('notices')
    expect(sectionFromHash('')).toBe('overview')
    expect(sectionFromHash('#main', 'moderation')).toBe('moderation')
  })
})

describe('form errors', () => {
  it('keeps the first message per field and maps codes to English', () => {
    const errors = fieldErrors([
      { path: ['username'], message: 'username_format' },
      { path: ['username'], message: 'too_short' },
      { path: ['campus'], message: 'campus_physical' },
      { path: ['other'], message: 'something_new' },
      { path: [], message: 'too_short' },
    ])
    expect(errors.username).toMatch(/^Use 3–32 characters/)
    expect(errors.campus).toBe('Choose a physical campus.')
    expect(errors.other).toBe('This value is not valid.')
    expect(errors._form).toBe('This is too short.')
    expect(firstInvalid(['orgName', 'username', 'campus'] as const, errors)).toBe('username')
    expect(firstInvalid(['orgName'] as const, errors)).toBeNull()
  })
})
