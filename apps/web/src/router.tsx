import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router'
import { CAMPUSES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { LandingPage } from './routes/landing/LandingPage.tsx'
import { NotFoundPage } from './routes/NotFoundPage.tsx'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type DashboardSearch = { tab?: OrgType; q?: string; campus?: Campus; org?: string }

export function parseDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const tab: OrgType | undefined = search.tab === 'school' || search.tab === 'club' ? search.tab : undefined
  const q = typeof search.q === 'string' && search.q.trim() ? search.q.trim().slice(0, 100) : undefined
  const campus = typeof search.campus === 'string' && (CAMPUSES as readonly string[]).includes(search.campus) ? (search.campus as Campus) : undefined
  const org = typeof search.org === 'string' && UUID_RE.test(search.org) ? search.org : undefined
  return { ...(tab ? { tab } : {}), ...(q ? { q } : {}), ...(campus ? { campus } : {}), ...(org ? { org } : {}) }
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundPage,
})

// "/" — landing (eager: its markup must be ready on the first render).
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: LandingPage })

// Pages serves landing.html at /landing too; send that to the canonical "/".
const landingAliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/landing',
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true })
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  validateSearch: parseDashboardSearch,
  component: lazyRouteComponent(() => import('./routes/dashboard/DashboardPage.tsx'), 'DashboardPage'),
})

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/e/$id',
  component: lazyRouteComponent(() => import('./routes/event/EventPage.tsx'), 'EventPage'),
})

const orgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/o/$slug',
  component: lazyRouteComponent(() => import('./routes/org/OrgPage.tsx'), 'OrgPage'),
})

const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rules',
  component: lazyRouteComponent(() => import('./routes/rules/RulesPage.tsx'), 'RulesPage'),
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazyRouteComponent(() => import('./routes/auth/LoginPage.tsx'), 'LoginPage'),
})

const mfaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/mfa',
  component: lazyRouteComponent(() => import('./routes/auth/MfaPage.tsx'), 'MfaPage'),
})

const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/studio',
  component: lazyRouteComponent(() => import('./routes/studio/StudioHome.tsx'), 'StudioHome'),
})

const newPostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/studio/new',
  component: lazyRouteComponent(() => import('./routes/studio/NewPostPage.tsx'), 'NewPostPage'),
})

const editPostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/studio/$id/edit',
  component: lazyRouteComponent(() => import('./routes/studio/EditPostPage.tsx'), 'EditPostPage'),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/studio/settings',
  component: lazyRouteComponent(() => import('./routes/studio/SettingsPage.tsx'), 'SettingsPage'),
})

const routeTree = rootRoute.addChildren([
  landingRoute,
  landingAliasRoute,
  dashboardRoute,
  eventRoute,
  orgRoute,
  rulesRoute,
  loginRoute,
  mfaRoute,
  studioRoute,
  newPostRoute,
  editPostRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
