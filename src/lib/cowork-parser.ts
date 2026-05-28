export interface ParsedOption {
  slot_description: string
  option_number: number
  product_name: string
  brand: string
  retailer: string
  price: string
  url: string
  sizes_available: string
  colors_available: string
  recommended_size: string
  recommended_color: string
  ship_timeline: string
  return_policy: string
  image_url: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ParsedSlot {
  description: string
  options: ParsedOption[]
}

function extractField(block: string, label: string): string {
  const patterns = [
    new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i'),
    new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)`, 'i'),
    new RegExp(`${label}:\\s*(.+)`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = block.match(pattern)
    if (match) return match[1].trim()
  }
  return ''
}

function parseConfidence(raw: string): 'high' | 'medium' | 'low' {
  const lower = raw.toLowerCase()
  if (lower.includes('high')) return 'high'
  if (lower.includes('medium')) return 'medium'
  return 'low'
}

function cleanPrice(raw: string): string {
  return raw.replace(/[^0-9.,]/g, '').trim()
}

function extractImageUrl(block: string): string {
  // Try explicit Image: field first (may be a markdown image or bare URL)
  const field = extractField(block, 'Image')
  const candidate = field || block

  // Markdown image: ![alt](url)
  const mdImage = candidate.match(/!\[[^\]]*\]\(([^)\s]+)\)/)
  if (mdImage) return mdImage[1].trim()

  // Markdown link wrapping an image url: [text](url.jpg)
  const mdLink = candidate.match(/\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|webp|gif|avif)[^)\s]*)\)/i)
  if (mdLink) return mdLink[1].trim()

  // Bare image URL anywhere in the field
  const bare = candidate.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif|avif)[^\s)]*/i)
  if (bare) return bare[0].trim()

  return field.trim()
}

export function parseCoworkOutput(raw: string): ParsedSlot[] {
  const slots: ParsedSlot[] = []

  const slotSections = raw.split(/^## Slot:/m).filter((s) => s.trim())

  for (const section of slotSections) {
    const lines = section.trim()
    const descMatch = lines.match(/^(.+?)(?:\n|$)/)
    const slotDesc = descMatch ? descMatch[1].trim() : 'Unknown item'

    const optionBlocks = lines.split(/^### Option \d+/m).filter((_, i) => i > 0)

    const options: ParsedOption[] = optionBlocks.map((block, i) => ({
      slot_description: slotDesc,
      option_number: i + 1,
      product_name: extractField(block, 'Product'),
      brand: extractField(block, 'Brand'),
      retailer: extractField(block, 'Retailer'),
      price: cleanPrice(extractField(block, 'Price')),
      url: extractField(block, 'URL'),
      sizes_available: extractField(block, 'Sizes Available'),
      colors_available: extractField(block, 'Colors Available'),
      recommended_size: extractField(block, 'Recommended Size'),
      recommended_color: extractField(block, 'Recommended Color'),
      ship_timeline: extractField(block, 'Ship Timeline'),
      return_policy: extractField(block, 'Return Policy'),
      image_url: extractImageUrl(block),
      confidence: parseConfidence(extractField(block, 'Confidence')),
    }))

    if (options.length > 0) {
      slots.push({ description: slotDesc, options })
    }
  }

  // Fallback: try parsing by ### headers with numbered options
  if (slots.length === 0) {
    const itemSections = raw.split(/^#{1,3}\s+\d+\.\s+/m).filter((s) => s.trim())
    for (const section of itemSections) {
      const descMatch = section.match(/^(.+?)(?:\n|$)/)
      const slotDesc = descMatch ? descMatch[1].trim() : 'Unknown item'

      const optionBlocks = section.split(/^#{1,4}\s*Option\s*\d+/im).filter((_, i) => i > 0)

      const options: ParsedOption[] = optionBlocks.map((block, i) => ({
        slot_description: slotDesc,
        option_number: i + 1,
        product_name: extractField(block, 'Product'),
        brand: extractField(block, 'Brand'),
        retailer: extractField(block, 'Retailer'),
        price: cleanPrice(extractField(block, 'Price')),
        url: extractField(block, 'URL'),
        sizes_available: extractField(block, 'Sizes Available'),
        colors_available: extractField(block, 'Colors Available'),
        recommended_size: extractField(block, 'Recommended Size'),
        recommended_color: extractField(block, 'Recommended Color'),
        ship_timeline: extractField(block, 'Ship Timeline'),
        return_policy: extractField(block, 'Return Policy'),
        image_url: extractImageUrl(block),
        confidence: parseConfidence(extractField(block, 'Confidence')),
      }))

      if (options.length > 0) {
        slots.push({ description: slotDesc, options })
      }
    }
  }

  return slots
}
