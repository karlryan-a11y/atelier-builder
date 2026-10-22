import { useEffect, useRef, useState } from 'react'
import { loadBoardImage, unusablePhotoPlaceholder } from '@/lib/loadBoardImage'
import { reportBuilderError } from '@/lib/reportError'

/**
 * Loads every picture on the board, ONLY through lib/loadBoardImage (ADR-0168). A picture that
 * cannot be loaded safely is drawn as a placeholder and listed in `unusable`, so Save can refuse
 * and name the piece. Never a tainted picture: one of those freezes the whole board.
 *
 * `loading` is every piece whose photo has not arrived yet. A photo is not drawn until it arrives,
 * so Save waits on this list before it takes the picture (lib/waitForPhotos, ADR-0194).
 */
export function useCanvasImages(imageUrls: Map<string, string | null>) {
  const [images, setImages] = useState<Map<string, HTMLImageElement | HTMLCanvasElement>>(new Map())
  const [unusable, setUnusable] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  // Track the URL currently loaded / loading per node id — keyed by URL, NOT just "has this id
  // loaded once". So when a node's URL CHANGES (e.g. after Remove BG returns a transparent
  // image) we reload it in place, instead of skipping it and needing a hard refresh.
  const loadedUrl = useRef(new Map<string, string>())
  const loadingUrl = useRef(new Map<string, string>())

  useEffect(() => {
    // Forget pieces that left the board, so a removed piece's "Photo unavailable" is gone with it.
    for (const id of [...loadedUrl.current.keys()]) if (!imageUrls.has(id)) loadedUrl.current.delete(id)
    setUnusable((prev) => { const n = new Set([...prev].filter((id) => imageUrls.has(id))); return n.size === prev.size ? prev : n })
    setLoading((prev) => { const n = new Set([...prev].filter((id) => imageUrls.get(id) && loadingUrl.current.get(id) === imageUrls.get(id))); return n.size === prev.size ? prev : n })
    for (const [id, url] of imageUrls) {
      if (!url) continue
      if (loadedUrl.current.get(id) === url || loadingUrl.current.get(id) === url) continue
      loadingUrl.current.set(id, url)
      setLoading((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      const settled = () => setLoading((prev) => {
        // A newer photo for this piece is still on its way: it stays loading.
        if (!prev.has(id) || loadingUrl.current.get(id)) return prev
        const n = new Set(prev); n.delete(id); return n
      })

      loadBoardImage(url).then(
        (img) => {
          if (loadingUrl.current.get(id) === url) loadingUrl.current.delete(id)
          loadedUrl.current.set(id, url)
          setImages((prev) => new Map(prev).set(id, img))
          setUnusable((prev) => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n })
          settled()
        },
        (err) => {
          if (loadingUrl.current.get(id) === url) loadingUrl.current.delete(id)
          loadedUrl.current.set(id, url)
          setImages((prev) => new Map(prev).set(id, unusablePhotoPlaceholder()))
          setUnusable((prev) => new Set(prev).add(id))
          settled()
          reportBuilderError('board_photo_unusable', err, { url })
        },
      )
    }
  }, [imageUrls])

  return { images, unusable, loading }
}
