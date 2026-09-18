// Browser-side helper for Claude calls.
//
// The browser NEVER holds an API key: a VITE_ value is compiled into the bundle, and the bundle is
// public, so a key placed there is readable by anyone who opens /style. We call our own
// /api/ai instead, which holds the key server-side and answers signed-in team members only.
// scripts/check-no-browser-secrets.mjs fails the build if a key ever reappears in the bundle.

import { supabase } from '@/lib/supabase'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  model?: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6'
  max_tokens?: number
  system?: string
  messages: AiMessage[]
}

/** The text of Claude's first content block, or '' when there is none. */
export async function aiText(req: AiRequest): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('sign in required')

  const resp = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(req),
  })

  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}))
    throw new Error(detail?.error || `ai request failed (${resp.status})`)
  }

  const body = await resp.json()
  const first = Array.isArray(body?.content) ? body.content[0] : null
  return first && first.type === 'text' ? String(first.text || '') : ''
}
