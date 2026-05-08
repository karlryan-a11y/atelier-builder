import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { Mail, ArrowRight, CheckCircle } from 'lucide-react'

export function LoginPage() {
  const { signInWithMagicLink } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const { error } = await signInWithMagicLink(email)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-wsg-cream flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-wsg-black">
            Atelier
            <span className="text-wsg-gold ml-1.5 font-normal">Builder</span>
          </h1>
          <p className="text-sm text-wsg-muted mt-2">
            Watson Style Group
          </p>
        </div>

        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          {sent ? (
            <div className="text-center py-4">
              <CheckCircle className="h-12 w-12 text-wsg-gold mx-auto mb-4" />
              <h2 className="text-lg font-medium mb-2">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                We sent a magic link to <strong>{email}</strong>. Click it to sign in.
              </p>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                className="mt-4 text-sm text-wsg-gold hover:underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block text-sm font-medium mb-2" htmlFor="email">
                Email address
              </label>
              <div className="relative mb-4">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@watsonstylegroup.com"
                  className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive mb-4">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-wsg-black text-wsg-white py-2.5 text-sm font-medium hover:bg-wsg-charcoal transition-colors disabled:opacity-50"
              >
                {submitting ? 'Sending...' : 'Send magic link'}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-wsg-muted text-center mt-6">
          Internal tool — authorized stylists only
        </p>
      </div>
    </div>
  )
}
