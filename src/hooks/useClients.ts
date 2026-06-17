import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Client {
  id: string
  name: string
}

export function useClients() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .order('name')

    setClients(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { clients, loading, refetch }
}
