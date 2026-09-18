// One place that turns the current Supabase session into the Authorization header our own
// serverless functions require (see api/_staff.ts).
//
// Every api/* function holds the service-role key, so each one now answers signed-in team members
// only. Any new caller must send this header or it gets a 401. scripts/check-api-auth.mjs keeps
// the server side honest; this keeps the browser side from forgetting.

import { supabase } from '@/lib/supabase'

export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}
