import { LogOut, Shield, ChevronDown } from 'lucide-react'
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

  // Active batch indicator for Digitize tab
  const hasBatch = typeof localStorage !== 'undefined' && localStorage.getItem('atelier_active_batch')

  return (
    <header className="h-[120px] bg-[#050505] flex items-center justify-between px-6 border-b border-white/[0.06]">
      <div className="flex items-center gap-8">
        <a href="/" className="transition-opacity duration-300 hover:opacity-80">
          <img
            src="/brand/atelier-logo-inverse.svg"
            alt="Atelier by Watson"
            className="h-[100px]"
          />
        </a>
        <nav className="flex items-center gap-0.5">
          {/* Order: Digitize → Style → Shop */}
          {onOpenInbox && (
            <button
              onClick={onOpenInbox}
              className="relative px-4 py-1.5 text-[11px] tracking-[0.22em] uppercase transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] text-white/50 hover:text-white/90"
            >
              Digitize
              {hasBatch && (
                <span className="absolute top-1 right-1.5 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              )}
            </button>
          )}
          <button
            onClick={() => setActiveView('style')}
            className={`px-4 py-1.5 text-[11px] tracking-[0.22em] uppercase transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeView === 'style'
                ? 'text-white'
                : 'text-white/50 hover:text-white/90'
            }`}
          >
            Style
            {activeView === 'style' && (
              <span className="block h-[1.5px] bg-[#F8E5E7] mt-0.5 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveView('shop')}
            className={`px-4 py-1.5 text-[11px] tracking-[0.22em] uppercase transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeView === 'shop'
                ? 'text-white'
                : 'text-white/50 hover:text-white/90'
            }`}
          >
            Shop
            {activeView === 'shop' && (
              <span className="block h-[1.5px] bg-[#F8E5E7] mt-0.5 rounded-full" />
            )}
          </button>
        </nav>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2.5 text-[11px] tracking-[0.15em] uppercase hover:opacity-80 transition-opacity duration-300 px-2 py-1"
        >
          <span className="text-white/50 font-light">{user.displayName}</span>
          <div className="w-7 h-7 rounded-full bg-[#F8E5E7]/15 flex items-center justify-center text-[10px] font-medium text-[#F8E5E7]">
            {initials}
          </div>
          <ChevronDown className="h-3 w-3 text-white/30" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded shadow-xl border border-black/[0.06] py-1 z-50">
            <div className="px-4 py-3 border-b border-black/[0.06]">
              <p className="text-[11px] font-medium text-[#1A1A1A] tracking-[0.02em]">{user.displayName}</p>
              <p className="text-[10px] text-[#6b6b6b] mt-0.5">{user.email}</p>
              <p className="text-[10px] tracking-[0.22em] uppercase text-[#F8E5E7] mt-1.5">{user.role}</p>
            </div>
            {onOpenAdmin && (
              <button
                onClick={() => { onOpenAdmin(); setMenuOpen(false) }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase hover:bg-[#F8F7F5] transition-colors duration-300 text-[#1A1A1A]"
              >
                <Shield className="h-3.5 w-3.5 text-[#6b6b6b]" />
                Team Management
              </button>
            )}
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase hover:bg-[#F8F7F5] transition-colors duration-300 text-[#6b6b6b]"
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
