import { supabase } from '@/lib/supabase'
import { useClientStore } from '@/stores/clientStore'

/**
 * Record what broke on a stylist's screen in public.builder_errors (migration 037, ADR-0168).
 *
 * 2026-10-07: Cynthia's board froze and the real error existed only in her browser console, so it
 * took an hour of rebuilding her steps to see it. Now it is written down the moment it happens.
 *
 * Never throws and never blocks the screen. The same message is recorded once a minute at most,
 * and at most 50 times per page load, so a loop cannot flood the table.
 */
const recent = new Map<string, number>()
let sent = 0

export function reportBuilderError(kind: string, err: unknown, context?: Record<string, unknown>): void {
  try {
    const e = err instanceof Error ? err : null
    const message = (e?.message ?? (typeof err === 'string' ? err : JSON.stringify(err ?? null))).slice(0, 2000)
    const sig = `${kind}|${message}`
    const now = Date.now()
    if ((recent.get(sig) ?? 0) > now - 60_000 || sent >= 50) return
    recent.set(sig, now)
    sent++
    const client = useClientStore.getState().activeClient
    void supabase.from('builder_errors').insert({
      kind,
      message,
      stack: e?.stack?.slice(0, 4000) ?? null,
      page: window.location.pathname,
      client_id: client?.id ?? null,
      context: { ...(context ?? {}), client_name: client?.name ?? null },
      user_agent: navigator.userAgent.slice(0, 300),
    }).then(({ error }) => { if (error) console.warn('[builder_errors] not recorded:', error.message) })
  } catch { /* reporting must never be the thing that breaks */ }
}

/** Uncaught errors and rejected promises anywhere in the builder. Installed once, in main.tsx. */
export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => reportBuilderError('window_error', ev.error ?? ev.message, { source: ev.filename, line: ev.lineno }))
  window.addEventListener('unhandledrejection', (ev) => reportBuilderError('unhandled_rejection', ev.reason))
}
