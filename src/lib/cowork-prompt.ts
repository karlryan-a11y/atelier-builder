import type { ClientProfileDraft, ShoppingSlot } from '@/stores/shoppingStore'
import {
  SEASON_LABEL,
  SEASON_PALETTE,
  SEASON_ATTRS,
  WATSON_COLOR_RULES,
  type Season,
} from '@/lib/color-analysis'

export function generateCoworkPrompt(
  profile: ClientProfileDraft,
  slots: ShoppingSlot[],
  opts: { playbook?: string; learnings?: string; ingestSessionId?: string } = {}
): string {
  const activeSlots = slots.filter((s) => s.description.trim())
  const today = new Date().toISOString().split('T')[0]

  const sections: string[] = []

  sections.push(`# Shopping Brief — ${profile.client_name}`)
  sections.push(`**Generated:** ${today}`)
  sections.push(`**Items to source:** ${activeSlots.length}`)
  sections.push('')

  // Instructions for Cowork
  sections.push(`## Instructions`)
  sections.push('')
  sections.push(`You are shopping for a Watson Style Group client. For each item on the shopping list below, find **3 options** from online retailers. Prioritize the client's preferred brands and size requirements.`)
  sections.push('')
  sections.push(`For each option you find, capture:`)
  sections.push(`- Product name`)
  sections.push(`- Brand`)
  sections.push(`- Retailer (website name)`)
  sections.push(`- Price`)
  sections.push(`- Product URL (full link to the product page)`)
  sections.push(`- Available sizes (list what's in stock)`)
  sections.push(`- Available colors`)
  sections.push(`- Recommended size for this client (based on their sizing info below)`)
  sections.push(`- Recommended color`)
  sections.push(`- Estimated ship timeline`)
  sections.push(`- Return policy summary`)
  sections.push(`- Confidence level: **High** (client has bought this brand + size + silhouette before), **Medium** (brand OR silhouette match), or **Low** (net-new)`)
  sections.push(`- Direct image URL for the product's hero image (the full https link to the image file, ending in .jpg/.png/.webp)`)
  sections.push('')

  // WSG sourcing standards (embedded playbook — no external macro/repo needed)
  if (opts.playbook && opts.playbook.trim()) {
    sections.push('---')
    sections.push('')
    sections.push(`## WSG Sourcing Standards`)
    sections.push('')
    sections.push(opts.playbook.trim())
    sections.push('')
  }

  sections.push('---')
  sections.push('')

  // Client profile
  sections.push(`## Client Profile`)
  sections.push('')

  // What we've learned about this client from past WSG shopping
  if (opts.learnings && opts.learnings.trim()) {
    sections.push(`### What We've Learned About This Client (from past WSG shopping)`)
    sections.push('')
    sections.push(opts.learnings.trim())
    sections.push('')
  }

  // Sizes
  const sizes = [
    profile.size_top && `- **Top:** ${profile.size_top}`,
    profile.size_bottom && `- **Bottom:** ${profile.size_bottom}`,
    profile.size_dress && `- **Dress:** ${profile.size_dress}`,
    profile.size_outerwear && `- **Outerwear:** ${profile.size_outerwear}`,
    profile.size_shoe && `- **Shoe:** ${profile.size_shoe}`,
    profile.size_intimates && `- **Intimates:** ${profile.size_intimates}`,
    profile.size_accessories && `- **Accessories:** ${profile.size_accessories}`,
  ].filter(Boolean)

  if (sizes.length > 0) {
    sections.push(`### Default Sizes`)
    sections.push('')
    sections.push(sizes.join('\n'))
    sections.push('')
  }

  // Style story
  if (profile.style_story) {
    sections.push(`### Style Story`)
    sections.push('')
    sections.push(profile.style_story)
    sections.push('')
  }

  // Color analysis (WSG Color Analysis SOP) — drives precise, season-locked sourcing
  const season = profile.color_season as Season
  if (season || profile.color_temperature || profile.color_chroma) {
    sections.push(`### Color Analysis (Critical)`)
    sections.push('')
    if (season) {
      sections.push(`- **Season:** ${SEASON_LABEL[season]} (${SEASON_ATTRS[season]})`)
      sections.push(`- **Palette to favor:** ${SEASON_PALETTE[season]}`)
    }
    if (profile.color_temperature) sections.push(`- **Temperature:** ${profile.color_temperature}`)
    if (profile.color_chroma) sections.push(`- **Chroma:** ${profile.color_chroma}`)
    if (profile.color_depth) sections.push(`- **Depth:** ${profile.color_depth}`)
    if (profile.color_analysis_notes) sections.push(`- **Notes:** ${profile.color_analysis_notes}`)
    sections.push('')
    sections.push(`**Shopping rules (apply to every option):**`)
    WATSON_COLOR_RULES.forEach((rule) => sections.push(`- ${rule}`))
    sections.push('')
  }

  // Occasions
  if (profile.occasions.length > 0) {
    sections.push(`### Occasions`)
    sections.push('')
    sections.push(profile.occasions.join(', '))
    sections.push('')
  }

  // Colors
  if (profile.color_likes || profile.color_dislikes) {
    sections.push(`### Color Palette`)
    sections.push('')
    if (profile.color_likes) sections.push(`- **Yes:** ${profile.color_likes}`)
    if (profile.color_dislikes) sections.push(`- **No:** ${profile.color_dislikes}`)
    sections.push('')
  }

  // Fabrics
  if (profile.fabric_likes || profile.fabric_dislikes) {
    sections.push(`### Fabric Preferences`)
    sections.push('')
    if (profile.fabric_likes) sections.push(`- **Yes:** ${profile.fabric_likes}`)
    if (profile.fabric_dislikes) sections.push(`- **No:** ${profile.fabric_dislikes}`)
    sections.push('')
  }

  // Brand preferences
  if (profile.brand_preferred.length > 0 || profile.brand_blocked.length > 0) {
    sections.push(`### Brand Preferences`)
    sections.push('')
    if (profile.brand_preferred.length > 0) {
      sections.push(`- **Preferred:** ${profile.brand_preferred.join(', ')}`)
    }
    if (profile.brand_blocked.length > 0) {
      sections.push(`- **Never:** ${profile.brand_blocked.join(', ')}`)
    }
    sections.push('')
  }

  // No-fly list
  if (profile.no_fly_list) {
    sections.push(`### No-Fly List`)
    sections.push('')
    sections.push(profile.no_fly_list)
    sections.push('')
  }

  // Gap notes
  if (profile.gap_notes) {
    sections.push(`### What Client Already Owns`)
    sections.push('')
    sections.push(profile.gap_notes)
    sections.push('')
  }

  // General notes
  if (profile.general_notes) {
    sections.push(`### Stylist Notes`)
    sections.push('')
    sections.push(profile.general_notes)
    sections.push('')
  }

  sections.push('---')
  sections.push('')

  // Shopping list
  sections.push(`## Shopping List`)
  sections.push('')
  sections.push(`Find **3 options** for each item below.`)
  sections.push('')

  activeSlots.forEach((slot, i) => {
    const num = i + 1
    const parts = [`### ${num}. ${slot.description}`]
    const details: string[] = []
    if (slot.category) details.push(`**Category:** ${slot.category}`)
    if (slot.quality_bar === 'hero_piece') details.push(`**Quality:** Hero piece — invest in quality, this is a statement item`)
    if (slot.budget_guidance) details.push(`**Budget:** ~${slot.budget_guidance}`)
    if (slot.notes) details.push(`**Notes:** ${slot.notes}`)

    sections.push(parts[0])
    sections.push('')
    if (details.length > 0) {
      sections.push(details.join('\n'))
      sections.push('')
    }
  })

  sections.push('---')
  sections.push('')

  // Budget & logistics
  if (profile.budget_total || profile.deliver_by || profile.ship_to_address) {
    sections.push(`## Logistics`)
    sections.push('')
    if (profile.budget_total) sections.push(`- **Total budget:** ${profile.budget_total}`)
    if (profile.deliver_by) sections.push(`- **Deliver by:** ${profile.deliver_by}`)
    if (profile.ship_to_address) sections.push(`- **Ship to:** ${profile.ship_to_address}`)
    sections.push(`- **Return tolerance:** ${profile.return_tolerance}`)
    sections.push('')
  }

  sections.push('---')
  sections.push('')

  // Output format instructions
  sections.push(`## Output Format`)
  sections.push('')
  sections.push(`After shopping, provide your results in this exact format for each item:`)
  sections.push('')
  sections.push('```')
  sections.push(`## Slot: [item description from shopping list]`)
  sections.push('')
  sections.push(`### Option 1`)
  sections.push(`- **Product:** [product name]`)
  sections.push(`- **Brand:** [brand]`)
  sections.push(`- **Retailer:** [retailer name]`)
  sections.push(`- **Price:** $[price]`)
  sections.push(`- **URL:** [full product URL]`)
  sections.push(`- **Sizes Available:** [list]`)
  sections.push(`- **Colors Available:** [list]`)
  sections.push(`- **Recommended Size:** [size]`)
  sections.push(`- **Recommended Color:** [color]`)
  sections.push(`- **Ship Timeline:** [estimate]`)
  sections.push(`- **Return Policy:** [summary]`)
  sections.push(`- **Image:** [direct https URL to the product hero image, ending in .jpg/.png/.webp]`)
  sections.push(`- **Confidence:** [High/Medium/Low]`)
  sections.push('')
  sections.push(`### Option 2`)
  sections.push(`...`)
  sections.push('')
  sections.push(`### Option 3`)
  sections.push(`...`)
  sections.push('```')

  // Delivery — auto-upload straight onto the stylist's board (with manual fallback)
  if (opts.ingestSessionId) {
    sections.push('')
    sections.push('---')
    sections.push('')
    sections.push(`## Delivering Your Results`)
    sections.push('')
    sections.push(
      `**Preferred — auto-upload to the stylist's board.** When finished, send a single HTTP POST:`
    )
    sections.push('')
    sections.push('```')
    sections.push(`POST https://atelier-builder.vercel.app/api/shopping-ingest`)
    sections.push(`Content-Type: application/json`)
    sections.push('')
    sections.push(`{`)
    sections.push(`  "session_id": "${opts.ingestSessionId}",`)
    sections.push(`  "raw": "<your full Markdown results from the format above, as a string>"`)
    sections.push(`}`)
    sections.push('```')
    sections.push('')
    sections.push(
      `The server parses your results, permanently stores every product image, and drops the options straight onto the stylist's Shopping Board — no copy-paste needed. A 200 response with \`"ok": true\` means it worked.`
    )
    sections.push('')
    sections.push(
      `**Fallback:** if you can't POST, just return the Markdown results above and the stylist will paste or upload them.`
    )
  }

  return sections.join('\n')
}
