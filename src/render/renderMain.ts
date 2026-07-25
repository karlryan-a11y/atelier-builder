// Entry for render.html — the bare page the headless renderer box loads in an invisible browser.
// It pulls in the SAME index.css (so @font-face brand fonts register) and the shared draw code,
// then exposes a single `window.__atelierRender(spec)` the box calls via page.evaluate().
//
// The page needs NO Supabase / env / auth: the renderer box resolves the canvas_state + item
// image URLs server-side and passes a fully self-contained spec in.
import '../index.css'
import { renderCanvasComposite } from './composite'
import { renderCapsuleGrid, type CapsuleGridLook } from './capsuleGrid'
import type { LookCanvasState } from '@/types/canvas'

export type RenderSpec =
  | { kind: 'canvas'; canvasState: LookCanvasState; imageUrls: Record<string, string>; pixelRatio?: number }
  | { kind: 'capsuleGrid'; looks: CapsuleGridLook[] }

declare global {
  interface Window {
    /** Bake a hero from a self-contained spec. Resolves once fonts + images are drawn. */
    __atelierRender: (spec: RenderSpec) => Promise<unknown>
    /** Set true once the render bridge is installed — the box waits on this before evaluating. */
    __atelierRenderReady: boolean
  }
}

window.__atelierRender = async (spec) => {
  if (spec.kind === 'canvas') {
    return renderCanvasComposite(spec.canvasState, spec.imageUrls, { pixelRatio: spec.pixelRatio })
  }
  if (spec.kind === 'capsuleGrid') {
    return { pngBase64: await renderCapsuleGrid(spec.looks) }
  }
  throw new Error('unknown render spec')
}

window.__atelierRenderReady = true
