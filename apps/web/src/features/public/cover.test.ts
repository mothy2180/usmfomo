import { describe, expect, it } from 'vitest'
import { coverFor, hashString, orgInitial } from './cover.ts'

describe('generated cover', () => {
  it('uses the first letter or digit of the organiser', () => {
    expect(orgInitial('robotics club')).toBe('R')
    expect(orgInitial('  "3D" Printing Club')).toBe('3')
    expect(orgInitial('Élite')).toBe('É')
    expect(orgInitial('---')).toBe('?')
  })

  it('keeps one colour per organiser', () => {
    const org = { id: '22222222-2222-4222-8222-222222222222', name: 'Robotics Club', type: 'club' as const }
    expect(coverFor(org)).toEqual(coverFor(org))
    // The colour follows the id, so renaming the organiser keeps it.
    expect(coverFor({ ...org, name: 'Kelab Robotik' }).tone).toBe(coverFor(org).tone)
    expect(coverFor({ ...org, name: 'Kelab Robotik' }).initial).toBe('K')
    expect(hashString(org.id)).toBe(hashString(org.id))
    expect(hashString('a')).not.toBe(hashString('b'))
  })

  it('gives clubs warm colours and schools cool ones', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const club = new Set(ids.map((id) => coverFor({ id, name: 'A', type: 'club' }).tone))
    const school = new Set(ids.map((id) => coverFor({ id, name: 'A', type: 'school' }).tone))
    expect(club.size).toBeGreaterThan(1)
    expect([...club].some((tone) => school.has(tone))).toBe(false)
    for (const tone of [...club, ...school]) expect(tone).toMatch(/^from-[a-z]+-\d00 to-[a-z]+-\d00$/)
  })
})
