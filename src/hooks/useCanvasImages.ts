import { useEffect, useRef, useState } from 'react'
import { proxyImageUrl } from '@/lib/images'

export function useCanvasImages(imageUrls: Map<string, string | null>) {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  // Track the URL currently loaded / loading per node id — keyed by URL, NOT just "has this id
  // loaded once". So when a node's URL CHANGES (e.g. after Remove BG returns a transparent
  // image) we reload it in place, instead of skipping it and needing a hard refresh.
  const loadedUrl = useRef(new Map<string, string>())
  const loadingUrl = useRef(new Map<string, string>())

  useEffect(() => {
    for (const [id, url] of imageUrls) {
      if (!url) continue
      if (loadedUrl.current.get(id) === url || loadingUrl.current.get(id) === url) continue
      loadingUrl.current.set(id, url)

      const proxied = proxyImageUrl(url)
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (loadingUrl.current.get(id) === url) loadingUrl.current.delete(id)
        loadedUrl.current.set(id, url)
        setImages((prev) => new Map(prev).set(id, img))
      }
      img.onerror = () => {
        if (loadingUrl.current.get(id) === url) loadingUrl.current.delete(id)
        // Fallback: load without proxy/crossOrigin (tainted but visible).
        const fallback = new window.Image()
        fallback.onload = () => { loadedUrl.current.set(id, url); setImages((prev) => new Map(prev).set(id, fallback)) }
        fallback.src = url
      }
      img.src = proxied
    }
  }, [imageUrls])

  return images
}
