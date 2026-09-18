import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installChunkReload } from './lib/chunkReload.ts'

// Before anything lazy can load: a tab left open across a deploy reloads once instead of
// failing to open a screen (lib/chunkReload.ts).
installChunkReload()

// NOTE: the "Watson W" preloader (index.html) is dismissed by <App/> once AUTH RESOLVES
// (see App.tsx) — NOT on a fixed timer here. A timer dismissed the W mid-auth and exposed
// the login-page flash; keeping the W up until we know who's logged in fixes that.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
