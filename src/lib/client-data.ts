// Client data layer — load and save the imported/edited client profile bundle
// (profile, measurements, brand sizing, brand preferences, seasons) against the
// migration-004 Supabase tables. Reverse-maps the historical-import shapes back
// into the intake form draft so a stylist can view and edit existing clients.

import { supabase } from '@/lib/supabase'
import type { ClientProfileDraft } from '@/stores/shoppingStore'
import type { Season } from '@/lib/color-analysis'

// ---- Row shapes (editable in the UI) --------------------------------------

export interface MeasurementPair {
  key: string
  value: string
}

export interface BrandSizingRow {
  id?: string
  brand: string
  category: string // top|bottom|dress|outerwear|shoe|intimates|accessory
  size: string
  fit_note: string
  confidence?: string
}

export interface BrandPrefRow {
  id?: string
  brand: string
  preference: 'preferred' | 'neutral' | 'blocked'
  note: string
}

export interface SeasonRow {
  id?: string
  label: string
  season_type: string | null
  year: number | null
  budget_total: number | null
  notes: string | null
}

export interface ClientDataBundle {
  profileExists: boolean
  draft: Partial<ClientProfileDraft>
  measurements: MeasurementPair[]
  measuredOn: string | null
  brandSizing: BrandSizingRow[]
  brandPrefs: BrandPrefRow[]
  seasons: SeasonRow[]
}

// ---- Helpers ---------------------------------------------------------------

const VALID_SEASONS = ['spring', 'summer', 'autumn', 'winter']

function normalizeSeason(raw: unknown): Season {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  if (!s) return ''
  // Match exact words and 12-season sub-types ("warm autumn", "soft summer",
  // "deep winter", "true spring", "cool winter", "fall", etc.) by substring.
  if (s.includes('spring')) return 'spring'
  if (s.includes('summer')) return 'summer'
  if (s.includes('autumn') || s.includes('fall')) return 'autumn'
  if (s.includes('winter')) return 'winter'
  return (VALID_SEASONS.includes(s) ? s : '') as Season
}

function joinList(v: unknown): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ')
  if (typeof v === 'string') return v
  return ''
}

function splitList(v: string): string[] {
  return (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function asString(v: unknown): string {
  return v == null ? '' : String(v)
}

// color_palette / fabric_preferences were imported as {loves:[],avoids:[]};
// some rows may use {likes,dislikes}. Read both.
function readLikes(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) return ''
  return joinList((obj as any).loves ?? (obj as any).likes)
}
function readDislikes(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) return ''
  return joinList((obj as any).avoids ?? (obj as any).dislikes)
}

function measurementsDictToPairs(dict: Record<string, unknown> | null | undefined): MeasurementPair[] {
  if (!dict || typeof dict !== 'object') return []
  return Object.entries(dict).map(([key, value]) => ({ key, value: asString(value) }))
}

function pairsToDict(pairs: MeasurementPair[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pairs) {
    const k = p.key.trim()
    if (k) out[k] = p.value
  }
  return out
}

// ---- Load ------------------------------------------------------------------

export async function loadClientData(clientId: string): Promise<ClientDataBundle> {
  const [profileRes, measRes, sizingRes, prefRes, seasonRes] = await Promise.all([
    supabase.from('client_profiles').select('*').eq('client_id', clientId).maybeSingle(),
    supabase
      .from('client_measurements')
      .select('*')
      .eq('client_id', clientId)
      .order('measured_on', { ascending: false })
      .limit(1),
    supabase.from('client_brand_sizing').select('*').eq('client_id', clientId).order('brand'),
    supabase.from('client_brand_preferences').select('*').eq('client_id', clientId).order('brand'),
    supabase.from('shopping_seasons').select('*').eq('client_id', clientId).order('label'),
  ])

  const profile = profileRes.data as Record<string, any> | null
  const latestMeas = (measRes.data?.[0] as Record<string, any> | undefined) ?? null
  const sizing = (sizingRes.data as Record<string, any>[] | null) ?? []
  const prefs = (prefRes.data as Record<string, any>[] | null) ?? []
  const seasons = (seasonRes.data as Record<string, any>[] | null) ?? []

  // Brand preference name arrays for the Cowork brief
  const brand_preferred = prefs.filter((p) => p.preference === 'preferred').map((p) => p.brand)
  const brand_blocked = prefs.filter((p) => p.preference === 'blocked').map((p) => p.brand)

  // Prefer the latest dated measurement snapshot; fall back to the profile's
  // convenience snapshot.
  const measDict =
    latestMeas?.measurements && Object.keys(latestMeas.measurements).length > 0
      ? latestMeas.measurements
      : profile?.measurements ?? {}

  const cp = (profile?.color_palette ?? {}) as Record<string, unknown>

  const draft: Partial<ClientProfileDraft> = profile
    ? {
        size_top: asString(profile.size_top),
        size_bottom: asString(profile.size_bottom),
        size_dress: asString(profile.size_dress),
        size_outerwear: asString(profile.size_outerwear),
        size_shoe: asString(profile.size_shoe),
        size_intimates: asString(profile.size_intimates),
        size_accessories: asString(profile.size_accessories),
        style_story: asString(profile.style_story),
        occasions: Array.isArray(profile.occasions) ? profile.occasions : [],
        color_likes: readLikes(cp),
        color_dislikes: readDislikes(cp),
        fabric_likes: readLikes(profile.fabric_preferences),
        fabric_dislikes: readDislikes(profile.fabric_preferences),
        color_temperature: asString(cp.temperature) as ClientProfileDraft['color_temperature'],
        color_chroma: asString(cp.chroma) as ClientProfileDraft['color_chroma'],
        color_depth: asString(cp.depth) as ClientProfileDraft['color_depth'],
        color_season: normalizeSeason(profile.color_season),
        color_analysis_notes: asString(cp.analysis_notes),
        brand_preferred,
        brand_blocked,
        no_fly_list: asString(profile.no_fly_list),
        gap_notes: asString(profile.gap_notes),
        return_tolerance: (profile.return_tolerance || 'standard') as ClientProfileDraft['return_tolerance'],
      }
    : { brand_preferred, brand_blocked }

  return {
    profileExists: !!profile,
    draft,
    measurements: measurementsDictToPairs(measDict),
    measuredOn: latestMeas?.measured_on ?? null,
    brandSizing: sizing.map((r) => ({
      id: r.id,
      brand: r.brand,
      category: r.category,
      size: r.size,
      fit_note: asString(r.fit_note),
      confidence: r.confidence,
    })),
    brandPrefs: prefs.map((r) => ({
      id: r.id,
      brand: r.brand,
      preference: r.preference,
      note: asString(r.note),
    })),
    seasons: seasons.map((r) => ({
      id: r.id,
      label: r.label,
      season_type: r.season_type ?? null,
      year: r.year ?? null,
      budget_total: r.budget_total ?? null,
      notes: r.notes ?? null,
    })),
  }
}

// ---- Save ------------------------------------------------------------------

function todayISO(): string {
  // Local date as YYYY-MM-DD (measured_on is a date column)
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}

export interface SaveClientArgs {
  clientId: string
  draft: ClientProfileDraft
  measurements: MeasurementPair[]
  brandSizing: BrandSizingRow[]
  brandPrefs: BrandPrefRow[]
  // ids that were loaded but have since been removed in the editor
  originalSizingIds: string[]
  originalPrefIds: string[]
  // the measurement dict as originally loaded — to detect a real change
  originalMeasurements: MeasurementPair[]
}

export async function saveClientData(args: SaveClientArgs): Promise<void> {
  const { clientId, draft } = args

  // Preserve any extra keys already in color_palette while writing the
  // canonical loves/avoids + color-analysis fields.
  const color_palette: Record<string, unknown> = {
    loves: splitList(draft.color_likes),
    avoids: splitList(draft.color_dislikes),
  }
  if (draft.color_temperature) color_palette.temperature = draft.color_temperature
  if (draft.color_chroma) color_palette.chroma = draft.color_chroma
  if (draft.color_depth) color_palette.depth = draft.color_depth
  if (draft.color_analysis_notes) color_palette.analysis_notes = draft.color_analysis_notes

  const fabric_preferences = {
    loves: splitList(draft.fabric_likes),
    avoids: splitList(draft.fabric_dislikes),
  }

  const measDict = pairsToDict(args.measurements)

  // 1) Upsert the profile (unique on client_id)
  const profileRow = {
    client_id: clientId,
    size_top: draft.size_top || null,
    size_bottom: draft.size_bottom || null,
    size_dress: draft.size_dress || null,
    size_outerwear: draft.size_outerwear || null,
    size_shoe: draft.size_shoe || null,
    size_intimates: draft.size_intimates || null,
    size_accessories: draft.size_accessories || null,
    measurements: measDict,
    color_season: draft.color_season || null,
    style_story: draft.style_story || null,
    occasions: draft.occasions ?? [],
    color_palette,
    fabric_preferences,
    no_fly_list: draft.no_fly_list || null,
    gap_notes: draft.gap_notes || null,
    return_tolerance: draft.return_tolerance || 'standard',
    source: 'session',
    updated_at: new Date().toISOString(),
  }
  const { error: pErr } = await supabase
    .from('client_profiles')
    .upsert(profileRow, { onConflict: 'client_id' })
  if (pErr) throw new Error(`profile save failed: ${pErr.message}`)

  // 2) Measurements — only write a dated snapshot if they actually changed
  const origDict = pairsToDict(args.originalMeasurements)
  const changed = JSON.stringify(measDict) !== JSON.stringify(origDict)
  if (changed && Object.keys(measDict).length > 0) {
    const { error: mErr } = await supabase
      .from('client_measurements')
      .upsert(
        {
          client_id: clientId,
          measured_on: todayISO(),
          measurements: measDict,
          source: 'session',
        },
        { onConflict: 'client_id,measured_on' }
      )
    if (mErr) throw new Error(`measurements save failed: ${mErr.message}`)
  }

  // 3) Brand sizing — upsert present rows, delete removed ones
  const sizingRows = args.brandSizing
    .filter((r) => r.brand.trim() && r.category.trim() && r.size.trim())
    .map((r) => ({
      client_id: clientId,
      brand: r.brand.trim(),
      category: r.category.trim(),
      size: r.size.trim(),
      fit_note: r.fit_note?.trim() || null,
      confidence: r.confidence || 'worn_once',
      last_updated: new Date().toISOString(),
    }))
  if (sizingRows.length > 0) {
    const { error: sErr } = await supabase
      .from('client_brand_sizing')
      .upsert(sizingRows, { onConflict: 'client_id,brand,category' })
    if (sErr) throw new Error(`brand sizing save failed: ${sErr.message}`)
  }
  const keptSizingIds = new Set(args.brandSizing.map((r) => r.id).filter(Boolean) as string[])
  const removedSizing = args.originalSizingIds.filter((id) => !keptSizingIds.has(id))
  if (removedSizing.length > 0) {
    const { error } = await supabase.from('client_brand_sizing').delete().in('id', removedSizing)
    if (error) throw new Error(`brand sizing delete failed: ${error.message}`)
  }

  // 4) Brand preferences — upsert present rows, delete removed ones.
  //    Keep the brand-name arrays from the draft in sync: any preferred/blocked
  //    brand not already represented gets added.
  const prefByBrand = new Map<string, BrandPrefRow>()
  for (const r of args.brandPrefs) {
    if (r.brand.trim()) prefByBrand.set(r.brand.trim().toLowerCase(), r)
  }
  for (const b of draft.brand_preferred ?? []) {
    const key = b.trim().toLowerCase()
    if (b.trim() && !prefByBrand.has(key)) {
      prefByBrand.set(key, { brand: b.trim(), preference: 'preferred', note: '' })
    }
  }
  for (const b of draft.brand_blocked ?? []) {
    const key = b.trim().toLowerCase()
    if (b.trim() && !prefByBrand.has(key)) {
      prefByBrand.set(key, { brand: b.trim(), preference: 'blocked', note: '' })
    }
  }
  const prefRows = [...prefByBrand.values()].map((r) => ({
    client_id: clientId,
    brand: r.brand.trim(),
    preference: r.preference,
    note: r.note?.trim() || null,
  }))
  if (prefRows.length > 0) {
    const { error: bpErr } = await supabase
      .from('client_brand_preferences')
      .upsert(prefRows, { onConflict: 'client_id,brand' })
    if (bpErr) throw new Error(`brand preferences save failed: ${bpErr.message}`)
  }
  const keptPrefIds = new Set(args.brandPrefs.map((r) => r.id).filter(Boolean) as string[])
  const removedPrefs = args.originalPrefIds.filter((id) => !keptPrefIds.has(id))
  if (removedPrefs.length > 0) {
    const { error } = await supabase.from('client_brand_preferences').delete().in('id', removedPrefs)
    if (error) throw new Error(`brand preferences delete failed: ${error.message}`)
  }
}
