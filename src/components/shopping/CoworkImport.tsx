import { useState } from 'react'
import { Upload, Check, AlertCircle, Package } from 'lucide-react'
import { parseCoworkOutput, type ParsedSlot } from '@/lib/cowork-parser'
import { useShoppingStore } from '@/stores/shoppingStore'
import { useBoardStore } from '@/stores/boardStore'

export function CoworkImport() {
  const { session, setCoworkOutput, setStatus } = useShoppingStore()
  const { loadFromParsed } = useBoardStore()
  const [rawInput, setRawInput] = useState(session.cowork_output ?? '')
  const [parsed, setParsed] = useState<ParsedSlot[] | null>(null)
  const [imported, setImported] = useState(false)

  function handleParse() {
    const result = parseCoworkOutput(rawInput)
    setParsed(result)
  }

  function handleImport() {
    if (!parsed || parsed.length === 0) return
    setCoworkOutput(rawInput)
    setStatus('review_round_1')
    loadFromParsed(parsed)
    setImported(true)
  }

  const totalOptions = parsed?.reduce((sum, s) => sum + s.options.length, 0) ?? 0

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Paste Cowork Output
        </label>
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
                className="w-full py-3 bg-text text-white text-[11px] tracking-[0.25em] uppercase hover:bg-text/90 transition-colors rounded-sm"
              >
                Import to Shopping Board ({totalOptions} options)
              </button>
            </div>
          )}

          {imported && (
            <div className="px-5 py-4 border-t border-wsg-border">
              <div className="flex items-center gap-2 justify-center text-green-600">
                <Check className="h-4 w-4" />
                <span className="text-[11px] tracking-[0.2em] uppercase">
                  Imported — switch to Review
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
