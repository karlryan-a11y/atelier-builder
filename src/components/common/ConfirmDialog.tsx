import { useEffect } from 'react'

// Elegant in-app confirmation, replacing native window.confirm. Bottom-sheet on mobile
// (items-end, full width, rounded top), centered card on desktop. Layers above other
// modals at z-[70]. Escape or backdrop tap = cancel.

export interface ConfirmDialogProps {
  open: boolean
  eyebrow?: string
  title: string
  body: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, eyebrow, title, body, confirmLabel, cancelLabel = 'Cancel',
  tone = 'default', busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null

  const confirmClasses = tone === 'danger'
    ? 'bg-[#a33] text-white hover:bg-[#922]'
    : 'bg-[#1A1A1A] text-white hover:bg-[#333]'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40"
      onClick={() => { if (!busy) onCancel() }}
    >
      <div
        className="bg-white w-full sm:w-[420px] max-w-[440px] rounded-t-2xl sm:rounded-lg border border-border shadow-xl px-6 py-8 sm:px-7 sm:py-8"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="text-center">
          {eyebrow && <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 mb-3">{eyebrow}</p>}
          <h3 className="font-serif text-[1.5rem] leading-tight text-[#1A1A1A] mb-3">{title}</h3>
          <div className="text-sm text-text-muted leading-relaxed mb-8">{body}</div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-center gap-2.5">
          <button
            onClick={() => { if (!busy) onCancel() }}
            disabled={busy}
            className="px-6 py-3 text-[11px] tracking-[0.22em] uppercase text-text-muted hover:text-text transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-6 py-3 text-[11px] tracking-[0.22em] uppercase rounded-sm transition-colors disabled:opacity-50 ${confirmClasses}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
