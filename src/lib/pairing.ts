// Board proposal brain — given a batch's photos in upload order, propose items for the
// stylist to confirm. Greedy + garment-anchored (no fixed 2-stride), so a missing/extra
// photo can't cascade. Each item is flagged confident-or-not so the board pre-checks the
// clean ones and surfaces only the exceptions. Mirrors the unit-tested logic in
// .tools/proposePairing.mjs (garment-first, tag-first, single-photo, lone tags, unknowns).

export type PhotoRole = 'garment' | 'tag' | 'unknown' | null

export interface ProposalPhoto {
  id: string
  classified_as: PhotoRole
}

export interface ProposedItem {
  garmentId: string
  tagId: string | null
  confident: boolean
  note: string
}

export interface LoosePhoto {
  id: string
  reason: string
}

export interface Proposal {
  items: ProposedItem[]
  loose: LoosePhoto[]
}

export function proposePairing(photos: ProposalPhoto[]): Proposal {
  const items: ProposedItem[] = []
  const loose: LoosePhoto[] = []
  let pendingTag: ProposalPhoto | null = null // a tag seen before its garment (tag-first)

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]
    const role = p.classified_as

    if (role === 'garment') {
      const item: ProposedItem = { garmentId: p.id, tagId: null, confident: true, note: 'garment (single photo)' }
      if (pendingTag) {
        item.tagId = pendingTag.id
        pendingTag = null
        item.note = 'garment + tag (shot tag-first)'
      } else {
        const next = photos[i + 1]
        if (next && next.classified_as === 'tag') {
          item.tagId = next.id
          i++
          item.note = 'garment + tag'
        }
      }
      items.push(item)
    } else if (role === 'tag') {
      // a tag with one already pending means the previous tag never found a garment
      if (pendingTag) loose.push({ id: pendingTag.id, reason: 'tag with no garment' })
      pendingTag = p
    } else {
      // unknown/unclassified → render it but FLAG (never silently drop a possible garment)
      items.push({ garmentId: p.id, tagId: null, confident: false, note: 'unsure — is this a garment or a tag?' })
    }
  }
  if (pendingTag) loose.push({ id: pendingTag.id, reason: 'tag with no garment' })
  return { items, loose }
}
