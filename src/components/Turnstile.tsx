/**
 * Turnstile — Cloudflare Turnstile CAPTCHA wrapper.
 *
 * Cloudflare Turnstile saytının widget-i. Site key frontend-də, secret key
 * yalnız server tərəfdə (Supabase RPC və ya Edge Function) olmalıdır.
 *
 * İstifadə:
 *   <Turnstile siteKey="1x..." onToken={setToken} />
 *
 * Təhlükəsizlik:
 * - Site key public-dir (frontend-də saxlanıla bilər)
 * - Secret key server-də olmalıdır (kodda göstərilmir)
 * - Token verification server tərəfdə edilməlidir
 *   (pg_net extension və ya Supabase Edge Function)
 *
 * Env var:
 *   VITE_TURNSTILE_SITE_KEY — Cloudflare Turnstile dashboard-dan alın
 *
 * Əgər VITE_TURNSTILE_SITE_KEY təyin edilməyibsə, komponent render olunmur
 * (CAPTCHA opsional — test üçün keçid olur).
 */

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

interface TurnstileOptions {
  sitekey: string
  callback?: (token: string) => void
  'error-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact'
}

type TurnstileProps = {
  onToken: (token: string) => void
  onError?: () => void
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

let scriptLoaded = false
let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded && window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.onload = () => {
      scriptLoaded = true
      resolve()
    }
    script.onerror = () => reject(new Error('Turnstile script yüklənmədi'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

export default function Turnstile({ onToken, onError }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'disabled'>('loading')

  useEffect(() => {
    if (!SITE_KEY) {
      // Pattern C: inner async funksiya içində setState
      async function disable() {
        await Promise.resolve()
        setStatus('disabled')
        onToken('')
      }
      void disable()
      return
    }

    let disposed = false

    async function init() {
      if (!containerRef.current) return

      try {
        await loadTurnstileScript()
        if (disposed || !containerRef.current || !window.turnstile) return

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => {
            setStatus('ready')
            onToken(token)
          },
          'error-callback': () => {
            setStatus('error')
            if (onError) onError()
          },
          theme: 'light',
          size: 'normal',
        })
      } catch {
        if (disposed) return
        setStatus('error')
      }
    }

    void init()

    return () => {
      disposed = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
      }
    }
  }, [onToken, onError])

  if (status === 'disabled') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        CAPTCHA deaktivdir — VITE_TURNSTILE_SITE_KEY təyin edilməyib.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={containerRef} className="turnstile-container" />
      {status === 'error' && (
        <p className="text-xs text-red-600">CAPTCHA xətası — yeniləyin</p>
      )}
    </div>
  )
}
