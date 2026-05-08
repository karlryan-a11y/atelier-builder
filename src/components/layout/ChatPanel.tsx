import { Send } from 'lucide-react'

export function ChatPanel() {
  return (
    <aside className="w-80 border-l border-border bg-card flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Compose
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-sm text-muted-foreground">
          <p>Paste a SuperWhisper transcript or type a description to compose a look with AI.</p>
        </div>
      </div>
      <div className="p-4 border-t border-border">
        <div className="relative">
          <textarea
            placeholder="Describe a look..."
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <button className="absolute bottom-2 right-2 p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
