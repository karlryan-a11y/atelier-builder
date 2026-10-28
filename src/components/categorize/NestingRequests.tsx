import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { NestingRequest } from '@/hooks/useClientCategories'

/**
 * Groups the client asked for from her Collection (2026-10-28, Julia Driscoll and Paige), on top of
 * the Nesting categories tab. Apply puts each category inside the group exactly as if the stylist
 * had done it below; Dismiss removes the request and changes nothing on her site.
 */
export function NestingRequests({ who, requests, labelOf, apply, dismiss }: {
  who: string
  requests: NestingRequest[]
  labelOf: (slug: string) => string
  apply: (group: string, groupLabel: string, slugs: string[]) => Promise<{ ok: boolean; message?: string }>
  dismiss: (slugs: string[]) => Promise<{ ok: boolean; message?: string }>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // One card per group she asked for, whatever order the rows came in.
  const groups = useMemo(() => {
    const m = new Map<string, { group: string; label: string; slugs: string[] }>()
    for (const r of requests) {
      const g = m.get(r.group) ?? { group: r.group, label: r.groupLabel || labelOf(r.group), slugs: [] }
      g.slugs.push(r.slug)
      m.set(r.group, g)
    }
    return [...m.values()]
  }, [requests, labelOf])

  async function run(key: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    setProblem(null)
    setBusy(key)
    const res = await fn()
    setBusy(null)
    if (!res.ok) setProblem(res.message ?? 'That did not save.')
  }

  return (
    <div className="border border-[#1A1A1A] bg-[#FAF9F7] px-4 py-3.5 flex flex-col gap-3" data-testid="nesting-requests">
      <p className="text-[11px] tracking-[0.28em] uppercase">{who} asked for {groups.length === 1 ? 'a group' : `${groups.length} groups`}</p>
      {problem && <p className="text-[12px] text-[#9B3B3B]">{problem}</p>}
      {groups.map((g) => (
        <div key={g.group} className="flex items-center justify-between gap-4 flex-wrap bg-white border border-[#E8E4DF] px-3 py-2.5">
          <p className="text-[13px]">
            Put <strong>{g.slugs.map(labelOf).join(', ')}</strong> inside <strong>{g.label}</strong>
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => run(g.group, () => apply(g.group, g.label, g.slugs))}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] tracking-[0.1em] uppercase bg-[#1A1A1A] text-white disabled:opacity-40"
            >
              {busy === g.group && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Apply
            </button>
            <button
              onClick={() => run(`x:${g.group}`, () => dismiss(g.slugs))}
              disabled={busy !== null}
              className="text-[12px] text-[#888] hover:text-[#1A1A1A] disabled:opacity-40"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
