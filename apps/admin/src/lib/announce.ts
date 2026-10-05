import { createContext, useContext } from 'react'

/** Shows a short confirmation ("Post hidden.") in a polite live region. */
export const AnnounceContext = createContext<(message: string) => void>(() => {})

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext)
}
