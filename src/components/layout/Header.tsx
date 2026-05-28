import { LogOut, Shield, ChevronDown, Inbox } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useViewStore } from '@/stores/viewStore'

interface HeaderProps {
  user: {
    displayName: string
    email: string
    role: string
  }
  onSignOut: () => void
  onOpenAdmin?: () => void
  onOpenInbox?: () => void
}

export function Header({ user, onSignOut, onOpenAdmin, onOpenInbox }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { activeView, setActiveView } = useViewStore()

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials = user.displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="h-14 bg-[#1A1A1A] flex items-center justify-between px-4">
      <div className="flex items-center gap-6">
        <img
          src="/brand/atelier-logo-inverse.svg"
          alt="Atelier by Watson"
          className="h-10"
        />
        <nav className="flex items-center gap-1">
          <button
            onClick={() => setActiveView('style')}
            className={`px-3 py-1.5 text-[11px] tracking-[0.2em] uppercase rounded transition-colors ${
              activeView === 'style'
                ? 'text-white bg-white/10'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            Style
          </button>
          <button
            onClick={() => setActiveView('shop')}
            className={`px-3 py-1.5 text-[11px] tracking-[0.2em] uppercase rounded transition-colors ${
              activeView === 'shop'
                ? 'text-white bg-white/10'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            Shop
          </button>
        </nav>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 text-[11px] tracking-[0.15em] uppercase hover:bg-white/5 rounded px-2 py-1 transition-colors"
        >
          <span className="text-white/60">{user.displayName}</span>
          <div className="w-7 h-7 rounded-full bg-blush/20 flex items-center justify-center text-[10px] font-medium text-blush">
            {initials}
          </div>
          <ChevronDown className="h-3 w-3 text-white/40" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-sm shadow-lg border border-[#E8E4DF] py-1 z-50">
            <div className="px-4 py-3 border-b border-[#E8E4DF]">
              <p className="text-[11px] font-medium text-[#1A1A1A]">{user.displayName}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{user.email}</p>
              <p className="text-[10px] tracking-[0.2em] uppercase text-blush mt-1">{user.role}</p>
            </div>
            {onOpenInbox && (
              <button
                onClick={() => { onOpenInbox(); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase hover:bg-tile transition-colors text-[#1A1A1A]"
              >
                <Inbox className="h-3.5 w-3.5" />
                Intake Inbox
              </button>
            )}
            {onOpenAdmin && (
              <button
                onClick={() => { onOpenAdmin(); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase hover:bg-tile transition-colors text-[#1A1A1A]"
              >
                <Shield className="h-3.5 w-3.5" />
                Team Management
              </button>
            )}
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase hover:bg-tile transition-colors text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
