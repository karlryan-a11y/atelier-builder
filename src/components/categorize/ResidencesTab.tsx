import { useMemo, useState } from 'react'
import { Check, Home, Sparkles, Tag, X } from 'lucide-react'
import type { LookCategory, TaggableLook } from '@/hooks/useLookCategories'
import { useResidenceReview, type Provenance } from '@/hooks/useResidenceReview'

/**
 * Residence review — file the back-catalogue of looks by which home they belong to.
 *
 * Every card carries two independent opinions and lets the stylist settle it in one
 * click. They disagree in useful places: the image can't tell mountain evening wear
 * from city evening wear, and the pieces she's already placed can. The Disagreements
 * filter puts exactly those looks in front of her.
 *
 * Accepting writes an ordinary category assignment — the same thing clicking a chip
 * on the Looks tab does — so nothing here is a parallel system.
 */

interface Props {
  looks: TaggableLook[]
  categories: LookCategory[]
  review: ReturnType<typeof useResidenceReview>
  assignLook: (lookId: string, categoryId: string, on: boolean) => void | Promise<void>
}

type Filter = 'all' | 'high' | 'needs-eye' | 'aspen' | 'disagree'

/** The residence the placed pieces point at, when they point anywhere clearly. */
function provenanceLean(p: Provenance): string | null {
  const entries = Object.entries(p) as [string, number][]
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1])
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return null // genuinely split
  return entries[0][0]
}

export function ResidencesTab({ looks, categories, review, assignLook }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const { proposals, provenanceFor, placedCount, accept, dismiss, busy, loading, byConfidence } = review

  const residenceCats = useMemo(
    () => categories.filter((c) => c.is_residence === true),
    [categories],
  )
  const catBySlug = useMemo(
    () => new Map(residenceCats.map((c) => [c.slug, c])),
    [residenceCats],
  )
  const labelOfSlug = (slug: string) => catBySlug.get(slug)?.label ?? slug

  /** Looks still waiting, joined to their proposal and live provenance. */
  const rows = useMemo(() => {
    return looks
      .filter((l) => !l.archived && proposals.has(l.id))
      .map((look) => {
        const proposal = proposals.get(look.id)!
        const prov = provenanceFor(look.closetItemIds)
        return { look, proposal, prov, lean: provenanceLean(prov), placed: placedCount(look.closetItemIds) }
      })
  }, [looks, proposals, provenanceFor, placedCount])

  const visible = useMemo(() => rows.filter((r) => {
    switch (filter) {
      case 'high': return r.proposal.confidence === 'high'
      case 'needs-eye': return r.proposal.confidence !== 'high'
      case 'aspen': return r.proposal.slugs.includes('aspen') || r.lean === 'aspen'
      case 'disagree': return r.lean !== null && !r.proposal.slugs.includes(r.lean)
      default: return true
    }
  }), [rows, filter])

  const disagreeCount = rows.filter((r) => r.lean !== null && !r.proposal.slugs.includes(r.lean)).length
  const aspenCount = rows.filter((r) => r.proposal.slugs.includes('aspen') || r.lean === 'aspen').length

  const filters: { key: Filter; label: string; hint: string }[] = [
    { key: 'all', label: `All (${rows.length})`, hint: 'Every look still waiting for a home' },
    { key: 'high', label: `Confident (${byConfidence.high})`, hint: 'The image was unambiguous. On a 40-look test this tier was right every time.' },
    { key: 'needs-eye', label: `Needs your eye (${byConfidence.medium + byConfidence.low})`, hint: 'A lean, not a verdict — this tier was right about half the time. Worth actually looking.' },
    { key: 'aspen', label: `Aspen (${aspenCount})`, hint: 'Anything either signal connects to Aspen. The image alone under-finds Aspen, so start here.' },
    { key: 'disagree', label: `Disagreements (${disagreeCount})`, hint: "The pieces you've placed point somewhere the image didn't. Usually the pieces are right." },
  ]

  if (residenceCats.length === 0) {
    return <p className="text-[#888] text-sm">This client has no residences set up. Create them as categories on the Looks tab first.</p>
  }

  if (loading) return <p className="text-[#888] text-sm">Loading…</p>

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <Home className="w-6 h-6 text-[#E8E4DF]" />
        <p className="text-[#1A1A1A] text-sm">Every look has a home.</p>
        <p className="text-[#888] text-xs">Nothing left in the residence queue for this client.</p>
      </div>
    )
  }

  return (
    <>
      <div className="mb-5">
        <p className="text-[11px] text-[#888] leading-relaxed max-w-[720px] mb-3">
          Each look below has a suggested home and the reason behind it. Where the suggestion is right,
          one click files it; where it isn't, click the home you want instead. The second line shows how
          many pieces in that look you've already placed yourself, which is the more reliable signal of
          the two for anything that isn't obviously ski or beach.
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              title={f.hint}
              className={`px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded transition-colors ${
                filter === f.key ? 'bg-[#1A1A1A] text-white' : 'bg-white border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]'
              }`}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-[#888] text-sm">Nothing in this filter.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map(({ look, proposal, prov, lean, placed }) => {
            const proposedCatIds = proposal.slugs.map((s) => catBySlug.get(s)?.id).filter(Boolean) as string[]
            const isBusy = busy === look.id
            const disagrees = lean !== null && !proposal.slugs.includes(lean)
            return (
              <div key={look.id} className="bg-white rounded-sm border border-[#E8E4DF] flex flex-col">
                <div className="aspect-square flex items-center justify-center p-2 overflow-hidden border-b border-[#F0EDE9]">
                  {look.image
                    ? <img src={look.image} alt={look.name} className="max-w-full max-h-full object-contain" loading="lazy" />
                    : <Tag className="w-6 h-6 text-[#E8E4DF]" />}
                </div>

                <div className="px-3 pt-2.5 pb-3 flex flex-col flex-1">
                  <p className="text-[11px] text-[#1A1A1A] truncate">{look.name}</p>

                  {/* Signal 1 — what the image looked like */}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Sparkles className="w-3 h-3 text-[#bbb] flex-none" />
                    {proposal.slugs.map((s) => (
                      <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-[#F8E5E7]/60 text-[#1A1A1A]">{labelOfSlug(s)}</span>
                    ))}
                    <span
                      title={proposal.confidence === 'high'
                        ? 'Unambiguous in the image. This tier was right on every look in the accuracy test.'
                        : 'A lean, not a verdict. This tier was right about half the time — look before you accept.'}
                      className={`text-[8px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded ${
                        proposal.confidence === 'high' ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8F7F5] text-[#888] border border-[#E8E4DF]'
                      }`}
                    >{proposal.confidence}</span>
                  </div>
                  {proposal.reason && (
                    <p className="mt-1 text-[10px] text-[#888] leading-snug line-clamp-2" title={proposal.reason}>{proposal.reason}</p>
                  )}

                  {/* Signal 2 — pieces she has already placed herself */}
                  <p className={`mt-2 text-[10px] leading-snug ${disagrees ? 'text-[#1A1A1A]' : 'text-[#888]'}`}>
                    {placed === 0
                      ? <span className="text-[#bbb]">No pieces in this look placed yet</span>
                      : <>
                          <span className="text-[#bbb]">Your pieces: </span>
                          {(Object.entries(prov) as [string, number][])
                            .sort((a, b) => b[1] - a[1])
                            .map(([slug, n], i) => (
                              <span key={slug}>{i > 0 ? ' · ' : ''}{n} {labelOfSlug(slug)}</span>
                            ))}
                          {disagrees && <span className="ml-1 text-[#C4736B]">← differs</span>}
                        </>}
                  </p>

                  <div className="mt-auto pt-2.5">
                    {proposedCatIds.length > 0 && (
                      <button
                        onClick={() => accept(look.id, proposedCatIds, assignLook)}
                        disabled={isBusy}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] tracking-[0.08em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80 disabled:opacity-30"
                      >
                        <Check className="w-3 h-3" />
                        {isBusy ? 'Filing…' : `File in ${proposal.slugs.map(labelOfSlug).join(' + ')}`}
                      </button>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] text-[#bbb] tracking-[0.1em] uppercase mr-0.5">or</span>
                      {residenceCats.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => accept(look.id, [c.id], assignLook)}
                          disabled={isBusy}
                          title={`File this look in ${c.label} instead`}
                          className="px-2 py-1 text-[9px] rounded border border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5] disabled:opacity-30"
                        >{c.label}</button>
                      ))}
                      <button
                        onClick={() => dismiss(look.id)}
                        disabled={isBusy}
                        title="Take this out of the queue without filing it"
                        className="ml-auto p-1 rounded text-[#bbb] hover:text-[#1A1A1A] disabled:opacity-30"
                        aria-label="Skip this look"
                      ><X className="w-3 h-3" /></button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
