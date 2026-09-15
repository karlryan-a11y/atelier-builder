import { useCallback, useEffect, useState } from 'react'
import { fetchClientDirectory, type ClientEntry } from '@/lib/clientDirectory'

export function useClients() {
  const [clients, setClients] = useState<ClientEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setClients(await fetchClientDirectory())
    setLoading(false)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { clients, loading, refetch }
}
