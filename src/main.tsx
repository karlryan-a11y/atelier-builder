import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// NOTE: the "Watson W" preloader (index.html) is dismissed by <App/> once AUTH RESOLVES
// (see App.tsx) — NOT on a fixed timer here. A timer dismissed the W mid-auth and exposed
// the login-page flash; keeping the W up until we know who's logged in fixes that.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
