import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Dismiss the W preloader once React renders
function dismissPreloader() {
  const el = document.getElementById('atelier-preloader')
  if (el) {
    el.classList.add('is-done')
    setTimeout(() => el.remove(), 1000) // clean up after fade-out
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dismiss after a brief minimum display (prevents flash on fast loads)
setTimeout(dismissPreloader, 600)
