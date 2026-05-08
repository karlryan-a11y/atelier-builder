-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Hybrid search: structured filters + vector cosine similarity
CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding vector(1536),
  query_text text DEFAULT '',
  p_client_id text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id text,
  name text,
  brand text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci.id,
    ci.name,
    ci.brand,
    (1 - (ci.description_embedding <=> query_embedding))::float AS similarity
  FROM closet_items ci
  WHERE ci.is_deleted = false
    AND ci.description_embedding IS NOT NULL
    AND (p_client_id IS NULL OR ci.client_id = p_client_id)
    AND (p_brand IS NULL OR ci.brand ILIKE '%' || p_brand || '%')
    AND (p_tag_ids IS NULL OR EXISTS (
      SELECT 1 FROM closet_item_tags cit
      WHERE cit.closet_item_id = ci.id
      AND cit.tag_id = ANY(p_tag_ids)
    ))
    AND (1 - (ci.description_embedding <=> query_embedding)) > match_threshold
  ORDER BY ci.description_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Text-only search fallback (no embedding needed)
CREATE OR REPLACE FUNCTION text_search(
  query_text text,
  p_client_id text DEFAULT NULL,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id text,
  name text,
  brand text,
  rank float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci.id,
    ci.name,
    ci.brand,
    ts_rank(
      to_tsvector('english', coalesce(ci.name, '') || ' ' || coalesce(ci.brand, '')),
      plainto_tsquery('english', query_text)
    )::float AS rank
  FROM closet_items ci
  WHERE ci.is_deleted = false
    AND (p_client_id IS NULL OR ci.client_id = p_client_id)
    AND to_tsvector('english', coalesce(ci.name, '') || ' ' || coalesce(ci.brand, ''))
        @@ plainto_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
