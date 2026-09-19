/**
 * DEV-ONLY measurement build of the real builder app. Never shipped: the production build uses
 * vite.config.ts, whose inputs are index.html and render.html only.
 *
 * It is the app, unchanged, plus render COUNTERS spliced in at build time, so the same harness
 * measures any checkout (origin/main vs a branch) without that checkout knowing about it:
 *   __counts.app / closetPanel / tile / chatPanel / lookGallery / categorizePanel
 * and the Zustand stores on window.__stores so the runner can pick a client and load a board.
 *
 * Driven by scripts/perf/style-harness.mjs (Playwright WebKit, iPad 1024x1366, mocked Supabase).
 */
import { mergeConfig, type Plugin } from 'vite'
import base from '../../vite.config'

const COUNTERS: Array<[RegExp, string, string]> = [
  // [file, anchor, counter]
  [/src\/App\.tsx$/, 'function App() {', 'app'],
  [/src\/components\/layout\/ClosetPanel\.tsx$/, 'export function ClosetPanel() {', 'closetPanel'],
  [/src\/components\/layout\/ChatPanel\.tsx$/, 'export function ChatPanel() {', 'chatPanel'],
  [/src\/components\/categorize\/CategorizePanel\.tsx$/, 'export function CategorizePanel() {', 'categorizePanel'],
]

function instrument(): Plugin {
  return {
    name: 'style-harness-instrument',
    enforce: 'pre',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head><script>window.__counts={};window.__count=function(k){window.__counts[k]=(window.__counts[k]||0)+1}</script>`,
      )
    },
    transform(code, id) {
      let out = code
      for (const [file, anchor, key] of COUNTERS) {
        if (file.test(id)) {
          if (!out.includes(anchor)) throw new Error(`harness: anchor "${anchor}" not found in ${id}`)
          out = out.replace(anchor, `${anchor} globalThis.__count(${JSON.stringify(key)});`)
        }
      }
      if (/src\/components\/layout\/ClosetPanel\.tsx$/.test(id)) {
        // Every closet tile render (old and new code both call useDraggable once per tile).
        if (!out.includes('= useDraggable(')) throw new Error('harness: useDraggable call not found in ClosetPanel')
        out = out.replace('= useDraggable(', '= (globalThis.__count("tile"), useDraggable)(')
      }
      if (/src\/components\/canvas\/LookGallery\.tsx$/.test(id)) {
        const a = 'export function LookGallery({ looks, loading, error, onRetry, currentLookId, onSelect, onDuplicate, onDelete, onNew }: LookGalleryProps) {'
        if (!out.includes(a)) throw new Error('harness: LookGallery anchor not found')
        out = out.replace(a, `${a} globalThis.__count("lookGallery");`)
      }
      if (/src\/main\.tsx$/.test(id)) {
        out += `
import { useCanvasStore as __c } from '@/stores/canvasStore'
import { useClientStore as __cl } from '@/stores/clientStore'
import { useViewStore as __v } from '@/stores/viewStore'
import __Konva from 'konva'
;(globalThis as any).__stores = { canvas: __c, client: __cl, view: __v }
;(globalThis as any).__Konva = __Konva
`
      }
      return out === code ? null : out
    },
  }
}

export default mergeConfig(base, {
  plugins: [instrument()],
  build: { outDir: 'dev/harness/dist', emptyOutDir: true, sourcemap: false },
  preview: { port: 5188, strictPort: true },
  server: { port: 5188, strictPort: true },
})
