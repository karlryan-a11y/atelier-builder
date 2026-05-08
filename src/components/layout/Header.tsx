import { LogOut, Shield, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

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
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Atelier
          <span className="text-wsg-gold ml-1 font-normal">Builder</span>
        </h1>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          v1
        </span>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 text-sm hover:bg-muted rounded-lg px-2 py-1 transition-colors"
        >
          <span className="text-muted-foreground">{user.displayName}</span>
          <div className="w-7 h-7 rounded-full bg-wsg-gold/20 flex items-center justify-center text-xs font-medium text-wsg-gold">
            {initials}
          </div>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-card rounded-lg shadow-lg border border-border py-1 z-50">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-medium">{user.displayName}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
              <p className="text-xs text-wsg-gold capitalize mt-0.5">{user.role}</p>
            </div>
            {onOpenAdmin && (
              <button
                onClick={() => { onOpenAdmin(); setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <Shield className="h-4 w-4" />
                Team Management
              </button>
            )}
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
