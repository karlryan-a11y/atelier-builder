import { useEffect, useRef, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { BRIDGE_REFRESH_TOKEN, fetchDashboardAccess } from '@/lib/dashboardBridge'

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
  // atelierbywatson.com/style), adopt the dashboard's login so one sign-in carries across.
  // ACCESS TOKEN ONLY. The dashboard's refresh token is never requested, stored or sent (sharing it
  // made both apps refresh one session family and Supabase revoked it: the surprise logouts). The
  // placeholder BRIDGE_REFRESH_TOKEN makes supabase-js re-ask the dashboard near expiry instead of
  // refreshing on its own (see src/lib/dashboardBridge.ts). Returns null if nobody is logged in there.
  async function adoptDashboardSession(): Promise<Session | null> {
    try {
      const access = await fetchDashboardAccess(fetch)
      if (!access) return null
      const { data, error } = await supabase.auth.setSession({
        access_token: access.access_token,
        refresh_token: BRIDGE_REFRESH_TOKEN,
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
    // Local scope: sign out THIS device only. The default (global) also ended every other device's
    // session: signing out on the phone logged the iPad out.
    await supabase.auth.signOut({ scope: 'local' })
    setUser(null)
    setSession(null)
  }

  return { session, user, loading, signInWithPassword, signOut }
}
