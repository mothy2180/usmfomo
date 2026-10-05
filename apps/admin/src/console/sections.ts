import { useEffect, useState } from 'react'

// Sections are addressed by the URL hash (#accounts), so Back/Forward and
// bookmarks work without a router. Unknown hashes (e.g. the #main skip link)
// keep the current section.

export const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'notices', label: 'Notices' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

export function sectionFromHash(hash: string, current: SectionId = 'overview'): SectionId {
  const id = hash.replace(/^#\/?/, '')
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : current
}

export function useSection(): SectionId {
  const [section, setSection] = useState<SectionId>(() => sectionFromHash(window.location.hash))
  useEffect(() => {
    const onHash = () => setSection((current) => sectionFromHash(window.location.hash, current))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return section
}
