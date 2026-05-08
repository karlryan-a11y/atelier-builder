import { useEffect, useRef, useState } from 'react'
import { proxyImageUrl } from '@/lib/images'

export function useCanvasImages(imageUrls: Map<string, string | null>) {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const loadingRef = useRef(new Set<string>())

  useEffect(() => {
    for (const [id, url] of imageUrls) {
      if (!url || images.has(id) || loadingRef.current.has(id)) continue
      loadingRef.current.add(id)

      const proxied = proxyImageUrl(url)
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        loadingRef.current.delete(id)
        setImages((prev) => new Map(prev).set(id, img))
      }
      img.onerror = () => {
        loadingRef.current.delete(id)
        // Fallback: load without proxy/crossOrigin (tainted but visible)
        const fallback = new window.Image()
        fallback.onload = () => setImages((prev) => new Map(prev).set(id, fallback))
        fallback.src = url
      }
      img.src = proxied
    }
  }, [imageUrls, images])

  return images
}
