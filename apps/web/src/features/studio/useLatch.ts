import { useState } from 'react'

/** True from the first render where `condition` held. Keeps a form (and its
 * "Published" panel) on screen when the limits it just used up refresh. */
export function useLatch(condition: boolean): boolean {
  const [latched, setLatched] = useState(condition)
  // Adjusting state while rendering (no effect round-trip, no flash).
  if (condition && !latched) setLatched(true)
  return latched || condition
}
