// The public site's locale files (studio and errors have their own owners).
import { describe, expect, it } from 'vitest'
import enCommon from '../../locales/en/common.json'
import enDashboard from '../../locales/en/dashboard.json'
import enLanding from '../../locales/en/landing.json'
import msCommon from '../../locales/ms/common.json'
import msDashboard from '../../locales/ms/dashboard.json'
import msLanding from '../../locales/ms/landing.json'

/** Every key path, with i18next plural suffixes folded (BM has no _one). */
function keys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [prefix]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  return [prefix.replace(/_(zero|one|two|few|many|other)$/, '')]
}
const keySet = (value: unknown) => [...new Set(keys(value))].sort()

/** Every string, arrays included. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

const namespaces = {
  common: [enCommon, msCommon],
  dashboard: [enDashboard, msDashboard],
  landing: [enLanding, msLanding],
} as const

describe('public locales', () => {
  it.each(Object.entries(namespaces))('%s has the same keys in English and BM', (_ns, [en, ms]) => {
    expect(keySet(ms)).toEqual(keySet(en))
  })

  it('call the owner "pentadbir usmfomo" in BM, never "admin usmfomo"', () => {
    const bm = Object.values(namespaces).flatMap(([, ms]) => strings(ms))
    expect(bm.filter((s) => /\badmin usmfomo\b/i.test(s))).toEqual([])
    expect(bm.some((s) => /\bpentadbir usmfomo\b/i.test(s))).toBe(true)
  })
})
