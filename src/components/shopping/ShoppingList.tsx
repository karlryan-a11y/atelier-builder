import { useState } from 'react'
import { Plus, X, Star, ClipboardList } from 'lucide-react'
import { useShoppingStore, type ShoppingSlot } from '@/stores/shoppingStore'
import { detectCategory } from '@/lib/categorize'

const CATEGORIES = [
  'Top', 'Bottom', 'Dress', 'Outerwear', 'Shoe', 'Bag', 'Accessory', 'Intimates', 'Activewear', 'Swimwear',
]

// Valid <select> values (lowercased)
const CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.toLowerCase()))

// Map detectCategory() output → a ShoppingList category value
const CATEGORY_MAP: Record<string, string> = {
  top: 'top',
  bottom: 'bottom',
  dress: 'dress',
  outerwear: 'outerwear',
  shoes: 'shoe',
  bag: 'bag',
  jewelry: 'accessory',
  belt: 'accessory',
  scarf: 'accessory',
  hat: 'accessory',
  accessory: 'accessory',
}

/** Parse one pasted line into slot fields. Splits "Description — notes", and
 *  auto-detects category, hero-piece, and budget from the text. */
function parseLine(line: string): Partial<ShoppingSlot> {
  const raw = line.replace(/^\s*[-*•\d.]+\s*/, '').trim() // strip leading bullets/numbers
  if (!raw) return { description: '' }

  // Split description from notes on the first em-dash / " - " / " | " / ":"
  const m = raw.match(/^(.*?)(?:\s+[—–]\s+|\s+-\s+|\s+\|\s+|:\s+)(.+)$/)
  const description = (m ? m[1] : raw).trim()
  const notes = (m ? m[2] : '').trim()

  const detected = detectCategory(description)
  const mapped = CATEGORY_MAP[detected] || ''
  const category = CATEGORY_VALUES.has(mapped) ? mapped : ''

  const quality_bar: ShoppingSlot['quality_bar'] = /hero\s*piece/i.test(raw)
    ? 'hero_piece'
    : 'daily_rotation'

  const budgetMatch = raw.match(/\$\s?[\d,]+(?:\s?[–—-]\s?\$?\s?[\d,]+)?/)
  const budget_guidance = budgetMatch ? budgetMatch[0].replace(/\s/g, '') : ''

  return { description, category, quality_bar, budget_guidance, notes }
}

function SlotRow({ slot }: { slot: ShoppingSlot }) {
  const { updateSlot, removeSlot } = useShoppingStore()

  return (
    <div className="group flex gap-3 items-start py-3 border-b border-wsg-border/50 last:border-0">
      <div className="flex-1 space-y-2">
        <input
          type="text"
          value={slot.description}
          onChange={(e) => updateSlot(slot.id, { description: e.target.value })}
          placeholder="Black belt, red pumps, suede jacket..."
          className="w-full bg-transparent text-sm focus:outline-none placeholder:text-text-muted/40"
        />
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={slot.category}
            onChange={(e) => updateSlot(slot.id, { category: e.target.value })}
            className="bg-transparent text-[10px] tracking-[0.15em] uppercase text-text-muted border border-wsg-border rounded-sm px-2 py-1 focus:outline-none focus:border-text"
          >
            <option value="">Category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c.toLowerCase()}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              updateSlot(slot.id, {
                quality_bar: slot.quality_bar === 'daily_rotation' ? 'hero_piece' : 'daily_rotation',
              })
            }
            className={`flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase px-2 py-1 rounded-sm border transition-colors ${
              slot.quality_bar === 'hero_piece'
                ? 'border-text bg-text text-white'
                : 'border-wsg-border text-text-muted hover:border-text/30'
            }`}
          >
            <Star className="h-2.5 w-2.5" />
            {slot.quality_bar === 'hero_piece' ? 'Hero piece' : 'Daily'}
          </button>
          <input
            type="text"
            value={slot.budget_guidance}
            onChange={(e) => updateSlot(slot.id, { budget_guidance: e.target.value })}
            placeholder="$"
            className="w-20 bg-transparent text-[11px] text-text-muted border-0 border-b border-wsg-border/50 pb-0.5 focus:outline-none focus:border-text placeholder:text-text-muted/30"
          />
        </div>
        <input
          type="text"
          value={slot.notes}
          onChange={(e) => updateSlot(slot.id, { notes: e.target.value })}
          placeholder="Notes — specific details, inspo, constraints..."
          className="w-full bg-transparent text-[11px] text-text-muted focus:outline-none placeholder:text-text-muted/30"
        />
      </div>
      <button
        onClick={() => removeSlot(slot.id)}
        className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-destructive transition-all mt-0.5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ShoppingList() {
  const { session, addSlot, addSlots } = useShoppingStore()
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(session.slots.length === 0)

  const pendingCount = bulk
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length

  function handleBulkAdd() {
    const items = bulk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parseLine)
      .filter((it) => it.description)
    if (items.length === 0) return
    addSlots(items)
    setBulk('')
    setShowBulk(false)
  }

  return (
    <div className="space-y-3">
      {/* Bulk paste — the fast path */}
      {showBulk ? (
        <div className="space-y-2 rounded-sm border border-wsg-border bg-tile/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-text-muted/70">
            <ClipboardList className="h-3 w-3" />
            Paste a list — one item per line
          </div>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={
              'Black blazer in a saturated color — defined waist, no shoulder details. Hero piece, $1,200–2,500\nNavy silk shell — body-skimming, 100% silk\nRed strappy heeled sandals — size 39.5–41'
            }
            rows={6}
            className="w-full bg-white rounded-sm border border-wsg-border p-3 text-[12px] leading-relaxed focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
          />
          <p className="text-[10px] text-text-muted/50">
            Each line becomes an item. Category, hero-piece, and budget are auto-detected; everything
            after a “—” becomes notes. You can fine-tune any row after adding.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleBulkAdd}
              disabled={pendingCount === 0}
              className="px-4 py-2 bg-text text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-text/90 transition-colors disabled:opacity-40"
            >
              Add {pendingCount > 0 ? `${pendingCount} item${pendingCount === 1 ? '' : 's'}` : 'items'}
            </button>
            {session.slots.length > 0 && (
              <button
                onClick={() => setShowBulk(false)}
                className="text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowBulk(true)}
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors py-1"
        >
          <ClipboardList className="h-3 w-3" />
          Paste a list
        </button>
      )}

      {session.slots.length > 0 && (
        <div className="mb-2">
          {session.slots.map((slot) => (
            <SlotRow key={slot.id} slot={slot} />
          ))}
        </div>
      )}

      <button
        onClick={addSlot}
        className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors py-2"
      >
        <Plus className="h-3 w-3" />
        Add one item
      </button>
    </div>
  )
}
