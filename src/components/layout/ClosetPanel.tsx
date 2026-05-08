import { Search } from 'lucide-react'

export function ClosetPanel() {
  return (
    <aside className="w-72 border-r border-border bg-card flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground mb-3">
          Closet
        </h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items..."
            className="w-full rounded-md border border-input bg-background px-8 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg bg-muted border border-border flex items-center justify-center text-xs text-muted-foreground"
            >
              Item {i + 1}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
