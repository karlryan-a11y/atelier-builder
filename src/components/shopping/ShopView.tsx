import { useState } from 'react'
import { ChevronDown, ShoppingBag, Clipboard, Sparkles, Copy, Check, FileText, Upload, ArrowLeft } from 'lucide-react'
import { useShoppingStore } from '@/stores/shoppingStore'
import { useBoardStore } from '@/stores/boardStore'
import { generateCoworkPrompt } from '@/lib/cowork-prompt'
import { ClientSelector } from './ClientSelector'
import { SizeForm } from './SizeForm'
import { StylePreferences } from './StylePreferences'
import { ShoppingList } from './ShoppingList'
import { CoworkImport } from './CoworkImport'
import { ShoppingBoard } from './ShoppingBoard'
import { TryOnView } from './TryOnView'

function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string
  icon: React.ElementType
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-wsg-border rounded-sm bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-tile/30 transition-colors"
      >
        <Icon className="h-4 w-4 text-text-muted/50" />
        <span className="text-[11px] tracking-[0.2em] uppercase text-text font-medium flex-1">
          {title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-text-muted/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  )
}

function LogisticsForm() {
  const { session, setProfile } = useShoppingStore()
  const { profile } = session

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-1.5">
            Total Budget
          </label>
          <input
            type="text"
            value={profile.budget_total}
            onChange={(e) => setProfile({ budget_total: e.target.value })}
            placeholder="$5,000"
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-1.5">
            Deliver By
          </label>
          <input
            type="date"
            value={profile.deliver_by}
            onChange={(e) => setProfile({ deliver_by: e.target.value })}
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors text-text-muted"
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-1.5">
          Ship-To Address
        </label>
        <input
          type="text"
          value={profile.ship_to_address}
          onChange={(e) => setProfile({ ship_to_address: e.target.value })}
          placeholder="123 Main St, City, State ZIP"
          className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
        />
      </div>
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Return Tolerance
        </label>
        <div className="flex gap-2">
          {(['conservative', 'standard', 'aggressive'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setProfile({ return_tolerance: level })}
              className={`px-3 py-1.5 text-[10px] tracking-[0.1em] uppercase rounded-sm border transition-colors ${
                profile.return_tolerance === level
                  ? 'bg-text text-white border-text'
                  : 'bg-transparent text-text-muted border-wsg-border hover:border-text/30'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function NotesForm() {
  const { session, setProfile } = useShoppingStore()

  return (
    <div>
      <textarea
        value={session.profile.general_notes}
        onChange={(e) => setProfile({ general_notes: e.target.value })}
        placeholder="Anything else — observations from the session, things that stood out, stylist instincts, context that might help with shopping. Just talk it out..."
        rows={5}
        className="w-full bg-tile/50 rounded-sm border border-wsg-border p-3 text-sm focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
      />
    </div>
  )
}

export function ShopView() {
  const { session, setCoworkPrompt, setStatus } = useShoppingStore()
  const boardSlots = useBoardStore((s) => s.slots)
  const [showPrompt, setShowPrompt] = useState(false)
  const [copied, setCopied] = useState(false)

  const isReviewMode = session.status.startsWith('review') && boardSlots.length > 0
  const isTryonMode = session.status === 'tryon' && boardSlots.length > 0
  const isCheckoutMode = (session.status === 'checkout' || session.status === 'ordered') && boardSlots.length > 0
  const hasClient = !!session.profile.client_id
  const hasSlots = session.slots.length > 0
  const slotsWithDescription = session.slots.filter((s) => s.description.trim())

  function handleGenerate() {
    const prompt = generateCoworkPrompt(session.profile, session.slots)
    setCoworkPrompt(prompt)
    setShowPrompt(true)
  }

  function handleCopy() {
    if (session.cowork_prompt) {
      navigator.clipboard.writeText(session.cowork_prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-tile">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-4">
        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-serif text-3xl text-text mb-1">
                {isTryonMode
                  ? `Try-On — ${session.profile.client_name}`
                  : isCheckoutMode
                  ? `Checkout — ${session.profile.client_name}`
                  : isReviewMode
                  ? `Shopping Board — ${session.profile.client_name}`
                  : 'Shopping Session'}
              </h1>
              <p className="text-[12px] text-text-muted">
                {isTryonMode
                  ? 'Mark items as kept, returned, or exchanged. Kept items add to closet.'
                  : isCheckoutMode
                  ? 'Order placed. Start try-on when items arrive.'
                  : isReviewMode
                  ? 'Review options. Approve, reject, or request swaps.'
                  : 'Build the client brief, then generate a prompt for Cowork.'}
              </p>
            </div>
            {(isReviewMode || isCheckoutMode || isTryonMode) && (
              <button
                onClick={() => setStatus('intake')}
                className="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Brief
              </button>
            )}
          </div>
        </div>

        {/* Try-on mode */}
        {isTryonMode && <TryOnView />}

        {/* Checkout / ordered — transition to try-on */}
        {isCheckoutMode && (
          <div className="border border-wsg-border rounded-sm bg-white p-8 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-green-50 flex items-center justify-center mx-auto">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="font-serif text-xl text-text">Order Handed Off</h2>
            <p className="text-[12px] text-text-muted max-w-md mx-auto">
              The assistant stylist has the cart details. Once items arrive and the fitting session is scheduled, start the try-on review.
            </p>
            <button
              onClick={() => setStatus('tryon')}
              className="px-6 py-3 bg-text text-white text-[11px] tracking-[0.25em] uppercase rounded-sm hover:bg-text/90 transition-colors"
            >
              Start Try-On Session
            </button>
          </div>
        )}

        {/* Shopping Board — review mode */}
        {isReviewMode && <ShoppingBoard />}

        {/* Intake mode — all sections */}
        {!isReviewMode && !isTryonMode && !isCheckoutMode && (
          <>
            <Section title="Client" icon={ShoppingBag} defaultOpen={true}>
              <ClientSelector />
            </Section>

            {hasClient && (
              <Section title="Default Sizes" icon={Clipboard} defaultOpen={true}>
                <SizeForm />
              </Section>
            )}

            {hasClient && (
              <Section title="Style & Preferences" icon={Sparkles} defaultOpen={true}>
                <StylePreferences />
              </Section>
            )}

            {hasClient && (
              <Section title="Shopping List" icon={ShoppingBag} defaultOpen={true}>
                <ShoppingList />
              </Section>
            )}

            {hasClient && (
              <Section title="Budget & Logistics" icon={Clipboard} defaultOpen={false}>
                <LogisticsForm />
              </Section>
            )}

            {hasClient && (
              <Section title="Additional Notes" icon={Sparkles} defaultOpen={false}>
                <NotesForm />
              </Section>
            )}

            {hasClient && hasSlots && slotsWithDescription.length > 0 && (
              <div className="pt-4 space-y-4">
                <button
                  onClick={handleGenerate}
                  className="w-full py-4 bg-text text-white text-[11px] tracking-[0.25em] uppercase hover:bg-text/90 transition-colors rounded-sm"
                >
                  Generate Cowork Prompt ({slotsWithDescription.length} items)
                </button>
              </div>
            )}

            {session.cowork_prompt && (
              <Section title="Import Cowork Results" icon={Upload} defaultOpen={false}>
                <CoworkImport />
              </Section>
            )}

            {showPrompt && session.cowork_prompt && (
              <div className="border border-wsg-border rounded-sm bg-white">
                <div className="flex items-center justify-between px-5 py-3 border-b border-wsg-border">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-text-muted/50" />
                    <span className="text-[11px] tracking-[0.2em] uppercase text-text font-medium">
                      Cowork Prompt
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase bg-text text-white rounded-sm hover:bg-text/90 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy to Clipboard
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowPrompt(false)}
                      className="text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors px-2 py-1.5"
                    >
                      Hide
                    </button>
                  </div>
                </div>
                <div className="p-5 max-h-[500px] overflow-y-auto">
                  <pre className="text-[12px] leading-relaxed text-text whitespace-pre-wrap font-sans">
                    {session.cowork_prompt}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}

        <div className="pb-12" />
      </div>
    </div>
  )
}
