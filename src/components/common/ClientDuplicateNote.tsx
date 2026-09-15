import type { ClientEntry } from '@/lib/clientDirectory'

/**
 * The name, star and grey line a picker row shows for a client (ADR-0122).
 * Clients without a twin render exactly as before: just the name.
 * Always visible, never hover-only: the stylists work on iPads (ADR-0108).
 */
export function ClientPickerLabel({ client }: { client: Pick<ClientEntry, 'name' | 'note' | 'badge'> }) {
  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate">{client.name}</span>
        {client.badge && (
          <span
            data-client-badge
            className={`flex-none text-[9px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded-sm ${
              client.badge === 'Kept separate' ? 'bg-[#F0EFEC] text-[#777]' : 'bg-[#F8E5E7] text-[#8a5a60]'
            }`}
          >
            {client.badge === 'Kept separate' ? client.badge : `★ ${client.badge}`}
          </span>
        )}
      </span>
      {client.note && (
        <span data-client-note className="block text-[11px] leading-snug text-[#999] mt-0.5">
          {client.note}
        </span>
      )}
    </span>
  )
}
