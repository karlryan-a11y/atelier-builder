import { useEffect, useRef, useState } from 'react'

/**
 * One object URL per file, created once and revoked when the file leaves the list or the
 * component unmounts.
 *
 * The Digitize upload grid called URL.createObjectURL(f) inside render, so every re-render (the
 * screen polls every few seconds) minted a fresh URL for every photo and never revoked any: each
 * one pins its full-size photo in memory until the tab closes. Forty iPad photos, re-rendered
 * for an hour, is how a tab gets killed by iOS mid-upload.
 */
export function useObjectUrls(files: readonly Blob[]): Map<Blob, string> {
  const cache = useRef(new Map<Blob, string>())
  const [urls, setUrls] = useState<Map<Blob, string>>(() => new Map())

  useEffect(() => {
    const c = cache.current
    const keep = new Set(files)
    for (const [f, u] of c) if (!keep.has(f)) { URL.revokeObjectURL(u); c.delete(f) }
    for (const f of files) if (!c.has(f)) c.set(f, URL.createObjectURL(f))
    setUrls(new Map(c))
  }, [files])

  useEffect(() => () => {
    for (const u of cache.current.values()) URL.revokeObjectURL(u)
    cache.current.clear()
  }, [])

  return urls
}
