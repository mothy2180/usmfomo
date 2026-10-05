import './styles.css'
import './lib/i18n.ts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router.tsx'

// After a deploy, an open tab may ask for lazy chunks that no longer exist.
// Reload once (not in a loop) to pick up the new build.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'usmfomo.reloadedAt'
  try {
    const last = Number(window.sessionStorage.getItem(key) ?? 0)
    if (Date.now() - last < 60_000) return
    window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // ignore storage errors
  }
  event.preventDefault()
  window.location.reload()
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
