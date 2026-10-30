/**
 * The style a NEW hand-made label starts with: the one the stylist last gave a label, like
 * GoodPix (Cynthia Dada, 2026-10-20). Saved per stylist on the device, so it carries over to the
 * next look or capsule, a reload and the next day. A stylist who has never styled a label gets
 * the brand default. AI-composed labels never read this; they keep their own brand styling.
 * Checked by scripts/check-label-style.mjs.
 */

export interface LabelStyle {
  font_family: string
  font_size: number
  bold: boolean
  underline: boolean
}

export const BRAND_LABEL_STYLE: LabelStyle = {
  font_family: "'Amalfi Coast', cursive",
  font_size: 32,
  bold: false,
  underline: false,
}

type DeviceStorage = Pick<Storage, 'getItem' | 'setItem'>

const keyFor = (stylistId: string | null | undefined) => `atelier-label-style:${stylistId || 'signed-out'}`

// For this visit only, when the device will not keep anything (storage blocked or full).
const thisVisit = new Map<string, LabelStyle>()

function valid(v: unknown): LabelStyle | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  if (typeof s.font_family !== 'string' || !s.font_family) return null
  if (typeof s.font_size !== 'number' || !Number.isFinite(s.font_size) || s.font_size <= 0) return null
  return { font_family: s.font_family, font_size: s.font_size, bold: s.bold === true, underline: s.underline === true }
}

export function labelStyleFor(storage: DeviceStorage | null, stylistId: string | null | undefined): LabelStyle {
  const key = keyFor(stylistId)
  try {
    const saved = storage?.getItem(key)
    if (saved) {
      const style = valid(JSON.parse(saved))
      if (style) return style
    }
  } catch {}
  return thisVisit.get(key) ?? { ...BRAND_LABEL_STYLE }
}

export function rememberLabelStyle(storage: DeviceStorage | null, stylistId: string | null | undefined, style: LabelStyle): void {
  const key = keyFor(stylistId)
  const clean = valid(style)
  if (!clean) return
  thisVisit.set(key, clean)
  try { storage?.setItem(key, JSON.stringify(clean)) } catch {}
}
