import type { OrgType } from '@usmfomo/shared/config'

// Generated covers for posts without a poster. Clubs get warm colours and
// schools cool ones; within that, each organiser keeps its own colour (picked
// from its id). Full class strings live here so Tailwind can see them.
const CLUB_TONES = [
  'from-rose-700 to-orange-600',
  'from-fuchsia-700 to-rose-600',
  'from-orange-700 to-amber-600',
  'from-red-700 to-pink-600',
  'from-pink-700 to-fuchsia-600',
  'from-amber-700 to-red-600',
] as const

const SCHOOL_TONES = [
  'from-sky-700 to-indigo-700',
  'from-teal-700 to-cyan-700',
  'from-blue-700 to-sky-600',
  'from-emerald-700 to-teal-600',
  'from-indigo-700 to-violet-600',
  'from-cyan-700 to-blue-700',
] as const

/** FNV-1a (32-bit): small, stable, good enough to spread ids over a palette. */
export function hashString(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** First letter or digit of the organiser's name, upper-cased. */
export function orgInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name)
  return m ? m[0].toUpperCase() : '?'
}

export function coverFor(org: { id: string; name: string; type: OrgType }): { initial: string; tone: string } {
  const tones = org.type === 'school' ? SCHOOL_TONES : CLUB_TONES
  return { initial: orgInitial(org.name), tone: tones[hashString(org.id) % tones.length] ?? tones[0] }
}
