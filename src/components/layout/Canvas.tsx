export function Canvas() {
  return (
    <main className="flex-1 bg-wsg-cream/30 flex items-center justify-center relative overflow-hidden">
      <div className="w-[1200px] h-[1500px] max-w-full max-h-full bg-white rounded-lg shadow-sm border border-border flex items-center justify-center scale-[0.45] origin-center">
        <p className="text-muted-foreground text-lg">
          Drop items here to build a look
        </p>
      </div>
    </main>
  )
}
