import { useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthUser {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'stylist' | 'support'
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        fetchUserProfile(session.user)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        fetchUserProfile(session.user)
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchUserProfile(authUser: User) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, display_name, role')
      .eq('email', authUser.email!)
      .single()

    if (error || !data) {
      setUser(null)
    } else {
      setUser({
        id: data.id,
        email: data.email,
        displayName: data.display_name,
        role: data.role,
      })
    }
    setLoading(false)
  }

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }

  return { session, user, loading, signInWithPassword, signOut }
}
