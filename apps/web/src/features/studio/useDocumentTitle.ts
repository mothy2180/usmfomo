import { useEffect } from 'react'

/** "<page> — usmfomo" (WCAG 2.4.2: every page has a descriptive title). */
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} — usmfomo`
  }, [page])
}
