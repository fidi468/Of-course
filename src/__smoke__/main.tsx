
// SMOKE TEST ENTRY — vite.smoke.config.ts vasitəsilə işə düşür.
// Real Supabase müştərisi mock ilə əvəz olunur.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App'
import '../i18n'

// ?path=/profile → replaceState ilə yol dəyişdirilir (BrowserRouter üçün)
// Not: /smoke.html/profile kimi nested yollar vite SPA fallback-i ilə real
// index.html-i yükləyir, ona görə yol "?path=" query paramı ilə verilir.
const url = new URL(window.location.href)
const targetPath = url.searchParams.get('path')

if (targetPath) {
  url.searchParams.delete('path')
  const qs = url.searchParams.toString()
  window.history.replaceState({}, '', targetPath + (qs ? `?${qs}` : ''))
}

const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
