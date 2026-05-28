import { useShoppingStore } from '@/stores/shoppingStore'

const OCCASION_OPTIONS = [
  'Daily', 'Work', 'Travel', 'Events', 'Fitness', 'Weekend', 'Date night', 'Vacation',
]

export function StylePreferences() {
  const { session, setProfile } = useShoppingStore()
  const { profile } = session

  function toggleOccasion(occ: string) {
    const current = profile.occasions
    if (current.includes(occ)) {
      setProfile({ occasions: current.filter((o) => o !== occ) })
    } else {
      setProfile({ occasions: [...current, occ] })
    }
  }

  return (
    <div className="space-y-6">
      {/* Style Story — large free-text */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Style Story / Vibe
        </label>
        <textarea
          value={profile.style_story}
          onChange={(e) => setProfile({ style_story: e.target.value })}
          placeholder="Describe the client's aesthetic — references, mood, how they want to feel. Anything you'd tell a fellow stylist about this person's style..."
          rows={4}
          className="w-full bg-tile/50 rounded-sm border border-wsg-border p-3 text-sm focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
        />
      </div>

      {/* Occasions — tag selection */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Occasions
        </label>
        <div className="flex flex-wrap gap-2">
          {OCCASION_OPTIONS.map((occ) => (
            <button
              key={occ}
              onClick={() => toggleOccasion(occ)}
              className={`px-3 py-1.5 text-[11px] tracking-[0.1em] rounded-sm border transition-colors ${
                profile.occasions.includes(occ)
                  ? 'bg-text text-white border-text'
                  : 'bg-transparent text-text-muted border-wsg-border hover:border-text/30'
              }`}
            >
              {occ}
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
            Colors — Yes
          </label>
          <input
            type="text"
            value={profile.color_likes}
            onChange={(e) => setProfile({ color_likes: e.target.value })}
            placeholder="Navy, cream, blush, olive..."
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
            Colors — No
          </label>
          <input
            type="text"
            value={profile.color_dislikes}
            onChange={(e) => setProfile({ color_dislikes: e.target.value })}
            placeholder="Neon, orange, bright yellow..."
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
      </div>

      {/* Fabrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
            Fabrics — Yes
          </label>
          <input
            type="text"
            value={profile.fabric_likes}
            onChange={(e) => setProfile({ fabric_likes: e.target.value })}
            placeholder="Cashmere, silk, linen..."
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
            Fabrics — No
          </label>
          <input
            type="text"
            value={profile.fabric_dislikes}
            onChange={(e) => setProfile({ fabric_dislikes: e.target.value })}
            placeholder="Polyester, stiff denim..."
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
      </div>

      {/* Brands */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
            Brands — Preferred
          </label>
          <input
            type="text"
            value={profile.brand_preferred.join(', ')}
            onChange={(e) =>
              setProfile({
                brand_preferred: e.target.value
                  .split(',')
                  .map((b) => b.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Vince, Theory, Dior, The Row..."
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
            Brands — Never
          </label>
          <input
            type="text"
            value={profile.brand_blocked.join(', ')}
            onChange={(e) =>
              setProfile({
                brand_blocked: e.target.value
                  .split(',')
                  .map((b) => b.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Fast fashion brands, etc..."
            className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
          />
        </div>
      </div>

      {/* No-fly list */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          No-Fly List
        </label>
        <textarea
          value={profile.no_fly_list}
          onChange={(e) => setProfile({ no_fly_list: e.target.value })}
          placeholder="Silhouettes, details, or prints the client doesn't wear. Be specific — crop tops, cold shoulder, animal print, etc."
          rows={2}
          className="w-full bg-tile/50 rounded-sm border border-wsg-border p-3 text-sm focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
        />
      </div>

      {/* Gap notes */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Gap Notes
        </label>
        <textarea
          value={profile.gap_notes}
          onChange={(e) => setProfile({ gap_notes: e.target.value })}
          placeholder="What the client already owns — '4 black blazers, don't source more.' Wardrobe gaps, things they're missing..."
          rows={2}
          className="w-full bg-tile/50 rounded-sm border border-wsg-border p-3 text-sm focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
        />
      </div>
    </div>
  )
}
