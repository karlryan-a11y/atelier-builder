// Persistent (IndexedDB) cache of perceptual hashes, keyed by the image's R2 key. The Audit's
// image-match layer fingerprints a client's whole collection once; caching the results means
// that ~minute-long pass is paid a single time per browser, then every later run is instant.
// We store the 64-bit dHash as a decimal string (IndexedDB can't store BigInt directly).

const DB_NAME = 'atelier-audit'
const STORE = 'dhash'
const VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Look up cached hashes for the given R2 keys. Missing keys are simply absent from the map. */
export async function getCachedHashes(keys: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>()
  if (keys.length === 0) return out
  let db: IDBDatabase
  try { db = await openDb() } catch { return out } // private mode / no IDB → behave as empty cache
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    await Promise.all(keys.map((k) => new Promise<void>((res) => {
      const rq = store.get(k)
      rq.onsuccess = () => { const v = rq.result; if (v != null) { try { out.set(k, BigInt(v)) } catch { /* skip */ } } res() }
      rq.onerror = () => res()
    })))
  } finally { db.close() }
  return out
}

/** Persist hashes (R2 key → dHash). No-op on failure (cache is an optimization, never required). */
export async function putCachedHashes(entries: [string, bigint][]): Promise<void> {
  if (entries.length === 0) return
  let db: IDBDatabase
  try { db = await openDb() } catch { return }
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [k, v] of entries) store.put(v.toString(), k)
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
  } catch { /* ignore */ } finally { db.close() }
}
