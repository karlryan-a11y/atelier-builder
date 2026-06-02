// @ts-nocheck — shopping board WIP, unused vars expected
import { useState } from 'react'
import { Upload, Check, AlertCircle, Package, Loader2, DownloadCloud } from 'lucide-react'
import { parseCoworkOutput, type ParsedSlot } from '@/lib/cowork-parser'
import { useShoppingStore } from '@/stores/shoppingStore'
import { useBoardStore } from '@/stores/boardStore'
import { useAuth } from '@/hooks/useAuth'
import { saveBrief, saveCoworkOptions, ingestResults, loadSessionBoard } from '@/lib/shopping-persistence'

export function CoworkImport() {
  const { session, setCoworkOutput, setStatus, setSessionId } = useShoppingStore()
  const { loadFromParsed } = useBoardStore()
  const { user } = useAuth()
  const [rawInput, setRawInput] = useState(session.cowork_output ?? '')
  const [parsed, setParsed] = useState<ParsedSlot[] | null>(null)
  const [imported, setImported] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rehosted, setRehosted] = useState<number | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)

  async function ensureSession(): Promise<string> {
    const store = useShoppingStore.getState()
    let sessionId = store.session.id
    if (!sessionId) {
      sessionId = await saveBrief({ ...store.session, cowork_output: rawInput }, user?.id ?? null)
      setSessionId(sessionId)
    }
    return sessionId
  }

  function handleParse() {
    setParsed(parseCoworkOutput(rawInput))
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    const text = await file.text()
    setRawInput(text)
    setParsed(parseCoworkOutput(text))
    setImported(false)
  }

  // Manual import: server parses + rehosts images + persists, then we load the
  // board from the DB (so images are the permanent stored copies).
  async function handleImport() {
    if (!parsed || parsed.length === 0) return
    setCoworkOutput(rawInput)
    setPersistError(null)
    setRehosted(null)
    setBusy(true)
    try {
      const sessionId = await ensureSession()
      const res = await ingestResults(sessionId, rawInput)
      setRehosted(res.rehosted)
      const boardSlots = await loadSessionBoard(sessionId, 1)
      loadFromParsed(boardSlots.length > 0 ? boardSlots : parsed)
      setStatus('review_round_1')
      setImported(true)
    } catch (e) {
      // Server import failed — fall back to local parse so the stylist isn't blocked
      loadFromParsed(parsed)
      setStatus('review_round_1')
      setImported(true)
      try {
        await saveCoworkOptions(useShoppingStore.getState().session.id ?? (await ensureSession()), useBoardStore.getState().slots, 1)
      } catch { /* best-effort */ }
      setPersistError(
        (e instanceof Error ? e.message : 'Server import failed') +
          ' — loaded locally; images may not all display.'
      )
    } finally {
      setBusy(false)
    }
  }

  // Cowork auto-upload path: pull results Cowork already POSTed to this session.
  async function handleLoadSourced() {
    const sessionId = useShoppingStore.getState().session.id
    if (!sessionId) {
      setPersistError('Generate the Cowork prompt first, then Cowork can auto-upload to this session.')
      return
    }
    setPersistError(null)
    setBusy(true)
    try {
      const boardSlots = await loadSessionBoard(sessionId, 1)
      if (boardSlots.length === 0) {
        setPersistError('No sourced results found yet. If Cowork just uploaded, give it a moment and try again.')
        return
      }
      loadFromParsed(boardSlots)
      setStatus('review_round_1')
      setImported(true)
    } catch (e) {
      setPersistError(e instanceof Error ? e.message : 'Could not load sourced results')
    } finally {
      setBusy(false)
    }
  }

  const totalOptions = parsed?.reduce((sum, s) => sum + s.options.length, 0) ?? 0

  return (
    <div className="space-y-4">
      {/* Cowork auto-upload path: pull results Cowork POSTed straight to this session */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border border-wsg-border rounded-sm bg-tile/40">
        <p className="text-[11px] text-text-muted">
          Cowork auto-uploaded? Pull the results it sent to this session.
        </p>
        <button
          onClick={handleLoadSourced}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase bg-white border border-wsg-border rounded-sm hover:border-text/40 transition-colors disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <DownloadCloud className="h-3 w-3" />}
          Load sourced results
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60">
            Paste Cowork Output (or upload / auto-upload above)
          </label>
          <label className="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors cursor-pointer">
            <Upload className="h-3 w-3" />
            Upload .md file
            <input
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
        </div>
        <textarea
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value)
            setParsed(null)
            setImported(false)
          }}
          placeholder="Paste the full Cowork shopping results here..."
          rows={12}
          className="w-full bg-tile/50 rounded-sm border border-wsg-border p-4 text-[12px] font-mono leading-relaxed focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
        />
      </div>

      {!parsed && rawInput.trim() && (
        <button
          onClick={handleParse}
          className="flex items-center gap-2 px-4 py-2.5 bg-text text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-text/90 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          Parse Results
        </button>
      )}

      {parsed && (
        <div className="border border-wsg-border rounded-sm bg-white">
          <div className="px-5 py-3 border-b border-wsg-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-text-muted/50" />
              <span className="text-[11px] tracking-[0.2em] uppercase text-text font-medium">
                Parse Preview
              </span>
            </div>
            <span className="text-[11px] text-text-muted">
              {parsed.length} items, {totalOptions} options
            </span>
          </div>

          {parsed.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <AlertCircle className="h-5 w-5 text-text-muted/30 mx-auto mb-2" />
              <p className="text-[12px] text-text-muted">
                Could not parse any items. Check that the output follows the expected format.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-wsg-border/50">
              {parsed.map((slot, i) => (
                <div key={i} className="px-5 py-3">
                  <p className="text-sm font-medium text-text mb-1">{slot.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {slot.options.map((opt) => (
                      <div
                        key={opt.option_number}
                        className="flex items-center gap-1.5 px-2 py-1 bg-tile rounded-sm"
                      >
                        <span className="text-[10px] text-text-muted">
                          {opt.brand || 'Unknown brand'}
                        </span>
                        <span className="text-[10px] text-text-muted/50">|</span>
                        <span className="text-[10px] text-text-muted">
                          {opt.price ? `$${opt.price}` : 'No price'}
                        </span>
                        <span
                          className={`text-[9px] tracking-[0.1em] uppercase px-1 rounded ${
                            opt.confidence === 'high'
                              ? 'bg-green-100 text-green-700'
                              : opt.confidence === 'medium'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {opt.confidence}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {parsed.length > 0 && !imported && (
            <div className="px-5 py-4 border-t border-wsg-border">
              <button
                onClick={handleImport}
                disabled={busy}
                className="w-full py-3 bg-text text-white text-[11px] tracking-[0.25em] uppercase hover:bg-text/90 transition-colors rounded-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? 'Importing + storing images…' : `Import to Shopping Board (${totalOptions} options)`}
              </button>
            </div>
          )}

          {imported && (
            <div className="px-5 py-4 border-t border-wsg-border space-y-1.5">
              <div className="flex items-center gap-2 justify-center text-green-600">
                <Check className="h-4 w-4" />
                <span className="text-[11px] tracking-[0.2em] uppercase">
                  Imported — switch to Review
                </span>
              </div>
              {rehosted !== null && rehosted > 0 && (
                <p className="text-[10px] text-text-muted text-center">
                  {rehosted} product image{rehosted === 1 ? '' : 's'} stored permanently
                </p>
              )}
              {persistError && (
                <p className="text-[10px] text-amber-600 text-center">{persistError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
