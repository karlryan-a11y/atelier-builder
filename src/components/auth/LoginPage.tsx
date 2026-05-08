import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

export function LoginPage() {
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

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
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@watsonstylegroup.com"
              className="w-full bg-transparent border-0 border-b border-[#E8E4DF] text-sm pb-2 mb-6 focus:outline-none focus:border-[#1A1A1A] transition-colors duration-200 placeholder:text-text-muted/50 placeholder:text-[11px] placeholder:tracking-[0.15em] placeholder:uppercase text-base"
            />

            <label
              className="block text-[10px] tracking-[0.35em] uppercase text-text-muted/60 mb-2"
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-transparent border-0 border-b border-[#E8E4DF] text-sm pb-2 mb-8 focus:outline-none focus:border-[#1A1A1A] transition-colors duration-200 placeholder:text-text-muted/50 text-base"
            />

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
