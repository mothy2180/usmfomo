import { describe, expect, it } from 'vitest'
import enErrors from '../../locales/en/errors.json'
import enStudio from '../../locales/en/studio.json'
import msErrors from '../../locales/ms/errors.json'
import msStudio from '../../locales/ms/studio.json'

/** Every string in a namespace, by its dotted key. */
function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  const out: Record<string, string> = {}
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) Object.assign(out, leaves(child, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

/** The {{placeholders}} and <tags> a translation must keep. */
const markers = (text: string) => [...text.matchAll(/\{\{\s*\w+\s*\}\}|<\/?\w+>/g)].map((m) => m[0].replace(/\s/g, '')).sort()

describe('studio and error translations', () => {
  const namespaces = [
    ['studio', enStudio, msStudio],
    ['errors', enErrors, msErrors],
  ] as const

  for (const [name, en, ms] of namespaces) {
    it(`${name}: Malay has exactly the English keys, with the same placeholders and tags`, () => {
      const english = leaves(en)
      const malay = leaves(ms)
      expect(Object.keys(malay).sort()).toEqual(Object.keys(english).sort())
      for (const [key, text] of Object.entries(english)) {
        expect(markers(malay[key] ?? ''), key).toEqual(markers(text))
        expect((malay[key] ?? '').trim(), key).not.toBe('')
      }
    })
  }

  it('uses the corrected Malay wording', () => {
    // The safe button beside "Padam siaran" means keep, not save ("Simpan").
    expect(msStudio.posts.keep).toBe('Kekalkan')
    // It used to say the opposite of the rule ("at the earliest a year earlier").
    expect(msErrors.start_too_late).toBe('Tarikh mula acara tidak boleh lebih daripada setahun dari sekarang.')
  })
})
