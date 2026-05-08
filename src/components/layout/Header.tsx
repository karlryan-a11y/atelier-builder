export function Header() {
  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Atelier
          <span className="text-wsg-gold ml-1 font-normal">Builder</span>
        </h1>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          v1
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Margaux Ellery</span>
        <div className="w-7 h-7 rounded-full bg-wsg-gold/20 flex items-center justify-center text-xs font-medium text-wsg-gold">
          ME
        </div>
      </div>
    </header>
  )
}
