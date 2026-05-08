import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface TagCategory {
  id: string
  name: string
  display_order: number | null
  client_visible: boolean
}

export interface Tag {
  id: string
  canonical_name: string
  display_name: string
  category_id: string
}

export function useContentTags() {
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    async function load() {
      const [catRes, tagRes] = await Promise.all([
        supabase
          .from('tag_categories')
          .select('id, name, display_order, client_visible')
          .order('display_order'),
        supabase
          .from('tags')
          .select('id, canonical_name, display_name, category_id')
          .order('display_name'),
      ])
      setCategories(catRes.data ?? [])
      setTags(tagRes.data ?? [])
    }
    load()
  }, [])

  return { categories, tags }
}
