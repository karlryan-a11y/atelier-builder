import { useState, useMemo } from 'react'
import { ExternalLink, Check, Copy, ClipboardList, ShoppingCart, Package } from 'lucide-react'
import { useBoardStore, type BoardOption } from '@/stores/boardStore'
import { useShoppingStore } from '@/stores/shoppingStore'

interface QAChecks {
  url_verified: boolean
  size_in_stock: boolean
  color_available: boolean
  price_confirmed: boolean
}

function getOrderSize(opt: BoardOption) {
  return opt.size_override || opt.recommended_size || '—'
}

function getOrderColor(opt: BoardOption) {
  return opt.color_override || opt.recommended_color || '—'
}

function RetailerGroup({
  retailer,
  items,
  qaState,
  onToggleQA,
}: {
  retailer: string
  items: { option: BoardOption; slotDescription: string }[]
  qaState: Record<string, QAChecks>
  onToggleQA: (optionId: string, field: keyof QAChecks) => void
}) {
  const subtotal = items.reduce((sum, { option }) => {
    const p = parseFloat(option.price)
    return sum + (isNaN(p) ? 0 : p)
  }, 0)

  return (
    <div className="border border-wsg-border rounded-sm bg-white">
      <div className="flex items-center justify-between px-5 py-3 border-b border-wsg-border">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-text-muted/50" />
          <span className="text-[11px] tracking-[0.2em] uppercase text-text font-medium">
            {retailer || 'Unknown Retailer'}
          </span>
          <span className="text-[10px] text-text-muted">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <span className="text-sm font-medium text-text">
          ${subtotal.toFixed(2)}
        </span>
      </div>

      <div className="divide-y divide-wsg-border/50">
        {items.map(({ option, slotDescription }) => {
          const checks = qaState[option.id] ?? {
            url_verified: false,
            size_in_stock: false,
            color_available: false,
            price_confirmed: false,
          }
          const allChecked = Object.values(checks).every(Boolean)

          return (
            <div key={option.id} className="px-5 py-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                {option.image_url && (
                  <img
                    src={option.image_url}
                    alt={option.product_name}
                    className="w-12 h-16 object-cover rounded-sm shrink-0 bg-tile"
                    loading="lazy"
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] tracking-[0.15em] uppercase text-text-muted/60 mb-0.5">
                    {slotDescription}
                  </p>
                  <p className="text-[11px] font-medium text-text uppercase tracking-[0.1em]">
                    {option.brand || 'Unknown'}
                  </p>
                  <p className="text-[11px] text-text-muted truncate">{option.product_name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-text">
                    {option.price ? `$${option.price}` : '—'}
                  </p>
                  {allChecked && (
                    <span className="inline-flex items-center gap-1 text-[9px] tracking-[0.1em] uppercase text-green-600 mt-0.5">
                      <Check className="h-2.5 w-2.5" />
                      QA'd
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
                <span>Size: <strong className="text-text">{getOrderSize(option)}</strong></span>
                <span>Color: <strong className="text-text">{getOrderColor(option)}</strong></span>
                {option.ship_timeline && <span>Ships: {option.ship_timeline}</span>}
                {option.return_policy && <span>Returns: {option.return_policy}</span>}
              </div>

              {option.url && (
                <a
                  href={option.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-blush-hover hover:underline"
                >
                  Open product page <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}

              <div className="grid grid-cols-2 gap-2">
                {([
                  ['url_verified', 'URL works'],
                  ['size_in_stock', 'Size in stock'],
                  ['color_available', 'Color available'],
                  ['price_confirmed', 'Price confirmed'],
                ] as [keyof QAChecks, string][]).map(([field, label]) => (
                  <label
                    key={field}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <div
                      className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${
                        checks[field]
                          ? 'bg-green-600 border-green-600'
                          : 'border-wsg-border group-hover:border-text/40'
                      }`}
                      onClick={() => onToggleQA(option.id, field)}
                    >
                      {checks[field] && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <span className={`text-[10px] tracking-[0.1em] uppercase ${
                      checks[field] ? 'text-text' : 'text-text-muted'
                    }`}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CartView() {
  const { slots } = useBoardStore()
  const { session, setStatus } = useShoppingStore()
  const [qaState, setQaState] = useState<Record<string, QAChecks>>({})
  const [copied, setCopied] = useState(false)

  const approvedItems = useMemo(() => {
    const items: { option: BoardOption; slotDescription: string }[] = []
    for (const slot of slots) {
      for (const opt of slot.options) {
        if (opt.status === 'approved') {
          items.push({ option: opt, slotDescription: slot.description })
        }
      }
    }
    return items
  }, [slots])

  const byRetailer = useMemo(() => {
    const groups = new Map<string, { option: BoardOption; slotDescription: string }[]>()
    for (const item of approvedItems) {
      const key = item.option.retailer || 'Unknown'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }
    return groups
  }, [approvedItems])

  const grandTotal = approvedItems.reduce((sum, { option }) => {
    const p = parseFloat(option.price)
    return sum + (isNaN(p) ? 0 : p)
  }, 0)

  const totalQAChecks = approvedItems.length * 4
  const completedQAChecks = Object.values(qaState).reduce(
    (sum, checks) => sum + Object.values(checks).filter(Boolean).length,
    0
  )
  const allQAPassed = totalQAChecks > 0 && completedQAChecks === totalQAChecks

  function toggleQA(optionId: string, field: keyof QAChecks) {
    setQaState((prev) => {
      const current = prev[optionId] ?? {
        url_verified: false,
        size_in_stock: false,
        color_available: false,
        price_confirmed: false,
      }
      return { ...prev, [optionId]: { ...current, [field]: !current[field] } }
    })
  }

  function handleCopyCart() {
    const lines: string[] = [
      `Shopping Cart — ${session.profile.client_name || 'Client'}`,
      `${approvedItems.length} items | $${grandTotal.toFixed(2)} total`,
      '',
    ]

    for (const [retailer, items] of byRetailer) {
      const subtotal = items.reduce((s, { option }) => {
        const p = parseFloat(option.price)
        return s + (isNaN(p) ? 0 : p)
      }, 0)
      lines.push(`## ${retailer} ($${subtotal.toFixed(2)})`)
      for (const { option, slotDescription } of items) {
        lines.push(`- ${option.brand} ${option.product_name} | ${slotDescription}`)
        lines.push(`  Size: ${getOrderSize(option)} | Color: ${getOrderColor(option)} | $${option.price || '—'}`)
        if (option.url) lines.push(`  ${option.url}`)
      }
      lines.push('')
    }

    if (session.profile.ship_to_address) {
      lines.push(`Ship to: ${session.profile.ship_to_address}`)
    }
    if (session.profile.deliver_by) {
      lines.push(`Deliver by: ${session.profile.deliver_by}`)
    }

    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleReadyForCheckout() {
    setStatus('checkout')
  }

  if (approvedItems.length === 0) {
    return (
      <div className="py-12 text-center">
        <ShoppingCart className="h-8 w-8 text-text-muted/20 mx-auto mb-3" />
        <p className="text-[11px] tracking-[0.2em] uppercase text-text-muted">
          No approved items yet. Approve items on the board to build the cart.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Cart header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-text-muted/50" />
            <span className="text-[11px] tracking-[0.2em] uppercase text-text font-medium">
              QA Checklist
            </span>
          </div>
          <p className="text-[10px] text-text-muted mt-0.5">
            {completedQAChecks}/{totalQAChecks} checks complete
          </p>
        </div>
        <button
          onClick={handleCopyCart}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase border border-wsg-border rounded-sm hover:bg-tile transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-green-600" />
              <span className="text-green-600">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 text-text-muted" />
              <span className="text-text-muted">Copy Cart</span>
            </>
          )}
        </button>
      </div>

      {/* Retailer groups */}
      {Array.from(byRetailer.entries()).map(([retailer, items]) => (
        <RetailerGroup
          key={retailer}
          retailer={retailer}
          items={items}
          qaState={qaState}
          onToggleQA={toggleQA}
        />
      ))}

      {/* Grand total */}
      <div className="flex items-center justify-between px-5 py-4 border border-wsg-border rounded-sm bg-white">
        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-text font-medium">
            Total
          </p>
          <p className="text-[10px] text-text-muted">
            {approvedItems.length} items across {byRetailer.size} {byRetailer.size === 1 ? 'retailer' : 'retailers'}
          </p>
        </div>
        <p className="text-lg font-serif text-text">${grandTotal.toFixed(2)}</p>
      </div>

      {/* Ready for checkout */}
      <button
        onClick={handleReadyForCheckout}
        disabled={!allQAPassed}
        className={`w-full py-4 text-[11px] tracking-[0.25em] uppercase rounded-sm transition-colors ${
          allQAPassed
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-tile text-text-muted/40 border border-wsg-border cursor-not-allowed'
        }`}
      >
        {allQAPassed
          ? 'Ready for Checkout — Hand Off to Assistant'
          : `Complete QA to Unlock (${totalQAChecks - completedQAChecks} remaining)`}
      </button>
    </div>
  )
}
