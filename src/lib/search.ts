import { supabase } from './supabase'
import { authHeader } from './authHeader'

// Embeddings are produced by our own /api/embed, never in the browser: an API key placed in browser
// code is compiled into the public bundle (see scripts/check-no-browser-secrets.mjs). When the
// server has no key configured, hybridSearch falls back to textSearch instead of failing.
async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ input: text }),
    })
    if (!resp.ok) return null
    const body = await resp.json()
    return Array.isArray(body?.embedding) ? body.embedding : null
  } catch {
    return null
  }
}

export interface SearchResult {
  id: string
  name: string
  brand: string
  similarity: number
}

export async function hybridSearch(
  query: string,
  clientId?: string,
  brand?: string,
  tagIds?: string[],
  limit = 20
): Promise<SearchResult[]> {
  const embedding = await getEmbedding(query)
  if (!embedding) return textSearch(query, clientId, limit)

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_embedding: JSON.stringify(embedding),
    query_text: query,
    p_client_id: clientId ?? null,
    p_brand: brand ?? null,
    p_tag_ids: tagIds ?? null,
    match_threshold: 0.3,
    match_count: limit,
  })

  if (error) {
    console.error('hybrid_search error:', error.message)
    return textSearch(query, clientId, limit)
  }

  return data ?? []
}

export async function textSearch(
  query: string,
  clientId?: string,
  limit = 20
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('text_search', {
    query_text: query,
    p_client_id: clientId ?? null,
    match_count: limit,
  })

  if (error) {
    console.error('text_search error:', error.message)
    return []
  }

  return (data ?? []).map((r: any) => ({
    ...r,
    similarity: r.rank,
  }))
}
