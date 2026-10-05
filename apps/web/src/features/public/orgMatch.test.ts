import { describe, expect, it } from 'vitest'
import { matchOrgs, normalizeText } from './orgMatch.ts'

const orgs = [
  { name: 'Robotics Club', type: 'club' as const },
  { name: 'Computer Science Society', type: 'club' as const },
  { name: 'Desasiswa Tekun Committee', type: 'club' as const },
  { name: 'Kelab Robotik Élite', type: 'club' as const },
  { name: 'School of Computer Sciences', type: 'school' as const },
  { name: 'School of Medical Sciences', type: 'school' as const },
]
const names = (r: { items: { name: string }[] }) => r.items.map((o) => o.name)

describe('matchOrgs', () => {
  it('lists every organiser of the tab A–Z for an empty query', () => {
    expect(names(matchOrgs(orgs, '', { type: 'school' }))).toEqual(['School of Computer Sciences', 'School of Medical Sciences'])
    expect(matchOrgs(orgs, '   ').items).toHaveLength(orgs.length)
  })

  it('ranks name prefix, then word start, then acronym, then anywhere', () => {
    expect(names(matchOrgs(orgs, 'robo'))).toEqual(['Robotics Club', 'Kelab Robotik Élite'])
    expect(names(matchOrgs(orgs, 'comp'))).toEqual(['Computer Science Society', 'School of Computer Sciences'])
    // Acronyms skip small words: "School of Computer Sciences" is "scs".
    expect(names(matchOrgs(orgs, 'css'))).toEqual(['Computer Science Society'])
    expect(names(matchOrgs(orgs, 'scs'))).toEqual(['School of Computer Sciences'])
    expect(names(matchOrgs(orgs, 'dtc'))).toEqual(['Desasiswa Tekun Committee'])
    expect(names(matchOrgs(orgs, 'ience'))).toEqual(['Computer Science Society', 'School of Computer Sciences', 'School of Medical Sciences'])
  })

  it('ignores case and accents', () => {
    expect(normalizeText('  Kelab  Élite ')).toBe('kelab elite')
    expect(names(matchOrgs(orgs, 'ELITE'))).toEqual(['Kelab Robotik Élite'])
  })

  it('filters by type', () => {
    expect(names(matchOrgs(orgs, 'comp', { type: 'club' }))).toEqual(['Computer Science Society'])
  })

  it('caps the list and says there are more', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Club ${String(i).padStart(2, '0')}`, type: 'club' as const }))
    const r = matchOrgs(many, 'club', { limit: 50 })
    expect(r.items).toHaveLength(50)
    expect(r.more).toBe(true)
    expect(matchOrgs(many, 'club 5', { limit: 50 }).more).toBe(false)
  })
})
