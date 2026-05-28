import { useShoppingStore } from '@/stores/shoppingStore'

const SIZE_FIELDS = [
  { key: 'size_top', label: 'Top', placeholder: 'S, M, 4, 6...' },
  { key: 'size_bottom', label: 'Bottom', placeholder: '26, 28, S, 4...' },
  { key: 'size_dress', label: 'Dress', placeholder: '4, 6, S, M...' },
  { key: 'size_outerwear', label: 'Outerwear', placeholder: 'S, M, 4...' },
  { key: 'size_shoe', label: 'Shoe', placeholder: '7, 7.5, 38...' },
  { key: 'size_intimates', label: 'Intimates', placeholder: '32B, S...' },
  { key: 'size_accessories', label: 'Accessories', placeholder: 'S, M, OS...' },
] as const

export function SizeForm() {
  const { session, setProfile } = useShoppingStore()

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
      {SIZE_FIELDS.map(({ key, label, placeholder }) => (
        <div key={key}>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-1.5">
            {label}
          </label>
          <input
            type="text"
            value={session.profile[key]}
            onChange={(e) => setProfile({ [key]: e.target.value })}
            placeholder={placeholder}
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
      ))}
    </div>
  )
}
