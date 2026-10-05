// The Edge Functions' only third-party dependency, pinned to the version the
// apps use (packages/shared). The Edge runtime fetches it from npm; keep every
// import of supabase-js going through this file so the pin lives in one place.
export { createClient } from 'npm:@supabase/supabase-js@2.117.2'
export type { JwtPayload, SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
