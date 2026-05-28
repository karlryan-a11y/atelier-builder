import { Plus, X, Star } from 'lucide-react'
import { useShoppingStore, type ShoppingSlot } from '@/stores/shoppingStore'

const CATEGORIES = [
  'Top', 'Bottom', 'Dress', 'Outerwear', 'Shoe', 'Bag', 'Accessory', 'Intimates', 'Activewear', 'Swimwear',
]

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
  const { session, addSlot } = useShoppingStore()

  return (
    <div>
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
        Add item
      </button>
    </div>
  )
}
