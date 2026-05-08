import { useState, useCallback } from 'react'
import { hybridSearch, textSearch, type SearchResult } from '../../lib/search'

export function SearchDebug() {
  const [query, setQuery] = useState('')
  const [clientId, setClientId] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'hybrid' | 'text'>('hybrid')
  const [elapsed, setElapsed] = useState<number | null>(null)

  const search = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResults([])
    const t0 = performance.now()

    try {
      const data =
        mode === 'hybrid'
          ? await hybridSearch(query, clientId || undefined)
          : await textSearch(query, clientId || undefined)
      setResults(data)
      setElapsed(Math.round(performance.now() - t0))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query, clientId, mode])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') search()
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h2 style={{ margin: '0 0 16px', color: '#1A1A1A' }}>Search Debug</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. white silk Dior skirt"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #E8E4DF',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          style={{
            padding: '8px 20px',
            background: loading ? '#ccc' : '#1A1A1A',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 14,
          }}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 13, color: '#666' }}>
          Client ID:
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="optional"
            style={{
              marginLeft: 6,
              padding: '4px 8px',
              border: '1px solid #E8E4DF',
              borderRadius: 4,
              fontSize: 13,
              width: 220,
            }}
          />
        </label>
        <label style={{ fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="radio"
            name="mode"
            checked={mode === 'hybrid'}
            onChange={() => setMode('hybrid')}
          />
          Hybrid (vector)
        </label>
        <label style={{ fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="radio"
            name="mode"
            checked={mode === 'text'}
            onChange={() => setMode('text')}
          />
          Text only
        </label>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {elapsed !== null && (
        <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
          {results.length} results in {elapsed}ms
        </div>
      )}

      {results.map((r, i) => (
        <div
          key={r.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            borderBottom: '1px solid #F0EEEB',
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: r.similarity > 0.6 ? '#4CAF50' : r.similarity > 0.4 ? '#FF9800' : '#999',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {i + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name || '(unnamed)'}
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>{r.brand || '(no brand)'}</div>
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: r.similarity > 0.6 ? '#4CAF50' : r.similarity > 0.4 ? '#FF9800' : '#999',
              flexShrink: 0,
            }}
          >
            {(r.similarity * 100).toFixed(1)}%
          </div>
        </div>
      ))}

      {results.length === 0 && !loading && elapsed !== null && (
        <div style={{ textAlign: 'center', padding: 32, color: '#999', fontSize: 14 }}>
          No results found
        </div>
      )}
    </div>
  )
}
