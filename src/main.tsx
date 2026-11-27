import './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// SPA deep-link fallback (Render statik hosting → 404.html handoff).
// 404.html birbaşa keçidin ünvanını yadda saxlayıb "/"-ə yönləndirir;
// burada həmin ünvanı tarixçəyə qaytarırıq ki, React Router onu görsün.
try {
  const dest = sessionStorage.getItem('ofcourse-spa-dest')
  if (dest && dest.startsWith('/') && !dest.startsWith('//')) {
    sessionStorage.removeItem('ofcourse-spa-dest')
    window.history.replaceState(null, '', dest)
  }
} catch {
  // sessionStorage yoxdursa adi yüklənmə ilə davam et
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
