// Test-only: render a page inside a memory router. Every other app path is a
// stub that prints "route:<path>", so tests can see where navigation went.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

const PATHS = ['/', '/login', '/login/mfa', '/studio', '/studio/new', '/studio/settings', '/studio/$id/edit', '/e/$id', '/rules', '/dashboard']

export function renderRoute(url: string, routePath: string, Page: () => ReactNode) {
  const root = createRootRoute({ component: Outlet })
  const children = PATHS.filter((p) => p !== routePath).map((p) =>
    createRoute({ getParentRoute: () => root, path: p, component: () => <p>route:{p}</p> }),
  )
  const page = createRoute({ getParentRoute: () => root, path: routePath, component: Page })
  const router = createRouter({ routeTree: root.addChildren([...children, page]), history: createMemoryHistory({ initialEntries: [url] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...view, router, queryClient }
}
