import OpenAI from 'openai'
import { supabase } from './supabase'

const EMBEDDING_MODEL = 'text-embedding-3-small'

let openaiClient: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: import.meta.env.VITE_OPENAI_API_KEY,
      dangerouslyAllowBrowser: true,
    })
  }
  return openaiClient
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  })
  return response.data[0].embedding
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
