// Lazy chunks the page works without (the 3D landing scene). When one fails to
// load, its error boundary keeps the fallback, so the stale-deploy reload in
// main.tsx must not fire for it.
let pending = 0

export function optionalImport<T>(load: () => Promise<T>): Promise<T> {
  pending++
  return load().finally(() => {
    pending--
  })
}

/** True while an optional chunk is loading (Vite's preload error fires then). */
export function optionalImportPending(): boolean {
  return pending > 0
}
