import { useEffect, useRef, useState } from 'react'
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
  // Distinguishes the user clicking Sign Out from the adopted session being revoked under us
  // (refresh-token rotation) — only the former may land on the login page without a re-adopt try.
  const explicitSignOutRef = useRef(false)

  useEffect(() => {
    let active = true
    // The async IIFE below owns the ENTIRE initial determination — including refreshing a stale
    // local session and adopting the dashboard's. Until it finishes, ALL auth events are ignored,
    // not just INITIAL_SESSION: when the stored refresh token is dead (the dashboard rotates the
    // shared token family on every refresh), getSession()'s failed refresh emits a mid-boot
    // SIGNED_OUT that used to slip past the INITIAL_SESSION guard, set loading=false, and flash
    // the login page for the ~2s the adoption still needed.
    let bootDone = false
    ;(async () => {
      let { data: { session } } = await supabase.auth.getSession()
      // No local session? Adopt the dashboard's login via the shared same-origin endpoint so an
      // admin/stylist who already signed in to the dashboard isn't forced to log in again here.
      if (!session) session = await adoptDashboardSession()
      if (!active) return
      bootDone = true
      setSession(session)
      if (session?.user) fetchUserProfile(session.user)
      else setLoading(false)
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!bootDone) return
      if (session?.user) {
        explicitSignOutRef.current = false
        setSession(session)
        fetchUserProfile(session.user)
        return
      }
      if (event !== 'SIGNED_OUT') return
      // An explicit sign-out is final. Anything else reaching here is the adopted session being
      // revoked out from under an open tab (refresh-token rotation by the dashboard): re-adopt
      // silently, keeping the current UI up — never drop a working stylist to the login page.
      if (explicitSignOutRef.current) {
        setSession(null)
        setUser(null)
        setLoading(false)
        return
      }
      ;(async () => {
        const readopted = await adoptDashboardSession()
        if (!active) return
        setSession(readopted)
        if (readopted?.user) {
          fetchUserProfile(readopted.user)
        } else {
          setUser(null)
          setLoading(false)
        }
      })()
    })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  // Bridge: when the builder has no session of its own (e.g. opened from the dashboard at
  // atelierbywatson.com/style), pull the dashboard's session from the shared same-origin endpoint
  // and adopt it — so one login carries across. Returns null if nobody is logged in there.
  async function adoptDashboardSession(): Promise<Session | null> {
    try {
      // Bound the wait so a stalled endpoint can't leave the preloader (and loading) hung forever.
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const resp = await fetch('/api/auth/session', { credentials: 'include', signal: ctrl.signal })
      clearTimeout(t)
      if (!resp.ok) return null
      const body = await resp.json().catch(() => null)
      if (!body?.access_token || !body?.refresh_token) return null
      const { data, error } = await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      })
      if (error) return null
      return data.session
    } catch {
      return null
    }
  }

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
    explicitSignOutRef.current = true
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }

  return { session, user, loading, signInWithPassword, signOut }
}
