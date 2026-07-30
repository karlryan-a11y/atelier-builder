// Runtime config for the renderer box. Fail fast on the must-haves so a mis-provisioned box
// crashes on boot (visible) instead of silently writing nothing.
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export const env = {
  /** e.g. https://xxxx.supabase.co */
  SUPABASE_URL: required('SUPABASE_URL'),
  /** anon key — used only to verify a caller's JWT (getUser). */
  SUPABASE_ANON_KEY: required('SUPABASE_ANON_KEY'),
  /** service role — reads canvas_state / items, writes baked hero fields (bypasses RLS). */
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  /** The invisible render page bundled by atelier-builder (render.html). Same origin as the
   *  builder so /img-proxy and image-proxy both resolve. */
  ATELIER_RENDER_URL: process.env.ATELIER_RENDER_URL || 'https://atelier-builder.vercel.app/render.html',
  /** Optional shared secret so a trusted server (e.g. the intake-replace edge function) can call
   *  /regenerate without a user JWT. Sent as the `x-renderer-secret` header. */
  RENDERER_SHARED_SECRET: process.env.RENDERER_SHARED_SECRET || '',
  PORT: Number(process.env.PORT || 8080),
} as const

/** image-proxy is a permanent, CORS-enabled, public URL that's a pure function of the R2 key —
 *  the lookbook + builder both resolve heroes through it (see wsg-lookbook supabase.ts). */
export function imageProxyUrl(key: string): string {
  return `${env.SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`
}
