import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

/**
 * Reveal control for a password field. Cynthia Dada, 2026-09-01: "can we have an
 * option to show the password we're entering on mobile?" The 44px box is Apple's
 * minimum tap target, not decoration.
 */
function PasswordEye({ open }: { open: boolean }) {
  return (
    <svg
      className="h-[18px] w-[18px]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      {open ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243"
        />
      ) : (
        <>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </>
      )}
    </svg>
  )
}

export function LoginPage() {
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    setShowPassword(false)

    try {
      const { error } = await signInWithPassword(email, password)
      if (error) {
        setError(error.message)
      }
    } catch (err) {
      setError('Connection error. Please try again.')
    }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-[#1A1A1A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <img
            src="/brand/atelier-logo-inverse.svg"
            alt="Atelier by Watson"
            className="h-12 mx-auto mb-3"
          />
          <p className="text-[10px] tracking-[0.35em] uppercase text-white/30">
            Stylist Portal
          </p>
        </div>

        <div className="bg-white rounded-sm p-8">
          <div className="h-[3px] bg-blush -mt-8 mb-8 -mx-8 rounded-t-sm" />

          <form onSubmit={handleSubmit}>
            <label
              className="block text-[10px] tracking-[0.35em] uppercase text-text-muted/60 mb-2"
              htmlFor="email"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@watsonstylegroup.com"
              className="w-full bg-transparent border-0 border-b border-[#E8E4DF] pb-2 mb-6 focus:outline-none focus:border-[#1A1A1A] transition-colors duration-200 placeholder:text-text-muted/50 placeholder:text-[11px] placeholder:tracking-[0.15em] placeholder:uppercase text-base"
            />

            <label
              className="block text-[10px] tracking-[0.35em] uppercase text-text-muted/60 mb-2"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative mb-8">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-transparent border-0 border-b border-[#E8E4DF] pb-2 pr-12 focus:outline-none focus:border-[#1A1A1A] transition-colors duration-200 placeholder:text-text-muted/50 text-base"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center text-text-muted/60 hover:text-[#1A1A1A] focus:text-[#1A1A1A] focus:outline-none transition-colors duration-200"
              >
                <PasswordEye open={showPassword} />
              </button>
            </div>

            {error && (
              <p className="text-sm text-destructive mb-4">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#1A1A1A] text-white text-[11px] tracking-[0.25em] uppercase py-3 px-8 hover:bg-[#1A1A1A]/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="h-[3px] bg-blush -mb-8 mt-8 -mx-8 rounded-b-sm" />
        </div>

        <p className="text-[10px] tracking-[0.3em] uppercase text-white/30 text-center mt-8">
          &copy; 2026 Watson Style Group.
        </p>
      </div>
    </div>
  )
}
