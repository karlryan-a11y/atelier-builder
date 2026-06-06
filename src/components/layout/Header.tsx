import { LogOut, Shield } from 'lucide-react'
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
}

export function Header({ user, onSignOut, onOpenAdmin }: HeaderProps) {
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
        <a href="/" className="flex flex-col transition-opacity duration-300 hover:opacity-80 py-2">
          <span
            className="text-white text-[42px] leading-none tracking-[0.015em]"
            style={{ fontFamily: "'Schnyder', Georgia, serif", fontWeight: 300 }}
          >
            ATELIER
          </span>
          <span
            className="text-white/50 text-[9px] tracking-[0.35em] uppercase mt-1.5"
            style={{ fontFamily: "'Neue Haas', 'Helvetica Neue', sans-serif", fontWeight: 300 }}
          >
            By Watson
          </span>
        </a>
        <div className="w-px h-8 bg-white/[0.08]" />
        <div className="flex items-center gap-1">
          {/* In-app tabs */}
          {(['digitize', 'style', 'shop'] as const).map(view => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`relative px-4 py-2 text-[13px] tracking-[0.22em] uppercase transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group ${
                activeView === view
                  ? 'text-white'
                  : 'text-white/80 hover:text-white'
              }`}
            >
              {view.charAt(0).toUpperCase() + view.slice(1)}
              <span className={`absolute left-4 right-4 bottom-0 h-[1.5px] bg-[#F8E5E7] rounded-full transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                activeView === view ? 'w-[calc(100%-2rem)]' : 'w-0 group-hover:w-[calc(100%-2rem)]'
              }`} style={{ left: '1rem' }} />
              {view === 'digitize' && activeView !== 'digitize' && hasBatch && (
                <span className="absolute top-1 right-1.5 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              )}
            </button>
          ))}

          {/* External platform links — same style */}
          <a
            href="/client-looks"
            className="relative px-4 py-2 text-[13px] tracking-[0.22em] uppercase text-white/80 hover:text-white transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group"
          >
            Looks
            <span className="absolute left-4 right-4 bottom-0 h-[1.5px] bg-[#F8E5E7] rounded-full transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] w-0 group-hover:w-[calc(100%-2rem)]" style={{ left: '1rem' }} />
          </a>
          <a
            href="/dash"
            className="relative px-4 py-2 text-[13px] tracking-[0.22em] uppercase text-white/80 hover:text-white transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group"
          >
            Dash
            <span className="absolute left-4 right-4 bottom-0 h-[1.5px] bg-[#F8E5E7] rounded-full transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] w-0 group-hover:w-[calc(100%-2rem)]" style={{ left: '1rem' }} />
          </a>
          {onOpenAdmin && (
            <a
              href="/admin/users"
              className="relative px-4 py-2 text-[13px] tracking-[0.22em] uppercase text-white/80 hover:text-white transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group"
            >
              Admin
              <span className="absolute left-4 right-4 bottom-0 h-[1.5px] bg-[#F8E5E7] rounded-full transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] w-0 group-hover:w-[calc(100%-2rem)]" style={{ left: '1rem' }} />
            </a>
          )}
        </div>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity duration-300 px-2 py-1"
        >
          <span className="text-[10px] tracking-[0.15em] uppercase text-white/40 font-light">{user.displayName}</span>
          <div className="w-6 h-6 rounded-full bg-[#F8E5E7]/12 flex items-center justify-center text-[9px] font-medium text-[#F8E5E7]/80">
            {initials}
          </div>
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
