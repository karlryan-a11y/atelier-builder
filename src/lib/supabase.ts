import { createClient } from '@supabase/supabase-js'
import { createBridgeFetch, defaultStorageKey } from '@/lib/dashboardBridge'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

// global.fetch goes to auth, rest and storage alike; the bridge only ever touches refresh-token
// grants (see dashboardBridge.ts) and passes everything else straight through.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createBridgeFetch(defaultStorageKey(supabaseUrl)) },
})
