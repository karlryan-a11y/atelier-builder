/**
 * What a grid shows when its read FAILED, instead of an empty grid.
 *
 * An empty grid after a 500 reads to a stylist as "her looks are gone". This says the truth
 * (we could not load them) and gives her one thing to do about it. Copy is checked by
 * scripts/check-load-errors.mjs: no em dashes.
 */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" data-load-error className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-[#888] text-sm">Couldn't load {what}.</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase border border-[#E8E4DF] rounded-sm text-[#1A1A1A] hover:border-blush"
      >
        Retry
      </button>
    </div>
  )
}
