/**
 * JitsiMeet — Jitsi Meet external_api.js iframe wrapper.
 *
 * Jitsi-nin rəsmi iframe API-sini istifadə edir (@jitsi/react-sdk əvəzinə)
 * çünki daha yüngüldür və əlavə peer dependency tələb etmir.
 *
 * İstifadə:
 *   <JitsiMeet roomName="of-course-123-abc" displayName="Fidan" onLeave={...} />
 *
 * Təhlükəsizlik:
 * - room_name caller tərəfindən təmin edilir (useLessonRoom hook-undan)
 * - displayName authenticated istifadəçinin adıdır
 * - Jitsi serveri env var ilə konfiqurasiya olunur (default: meet.jit.si)
 * - JWT auth tələb olunmur (ictimai server); otaq adı proqnozlaşdırıla bilməz
 */

import { useEffect, useRef, useState } from 'react'

// Jitsi external_api global type (script yüklənəndə pəncərəyə əlavə olunur)
declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (
      domain: string,
      options: JitsiOptions
    ) => JitsiApi
  }
}

type JitsiApi = {
  dispose: () => void
  executeCommand: (command: string, ...args: unknown[]) => void
  addEventListeners: (events: Record<string, (payload: unknown) => void>) => void
  removeEventListeners: (events: Record<string, (payload: unknown) => void>) => void
}

interface JitsiOptions {
  roomName: string
  parentNode: HTMLElement
  configOverwrite?: Record<string, unknown>
  interfaceConfigOverwrite?: Record<string, unknown>
  userInfo?: {
    displayName?: string
    avatarUrl?: string
  }
}

type JitsiMeetProps = {
  roomName: string
  displayName: string
  avatarUrl?: string
  onLeave?: () => void
  onError?: (message: string) => void
}

// Jitsi domain-i env dəyişənindən oxuyuruq; yoxdursa default ictimai server
const JITSI_DOMAIN =
  import.meta.env.VITE_JITSI_DOMAIN ?? 'meet.jit.si'

// external_api.js scriptini yalnız bir dəfə yükləyirik
let scriptLoadPromise: Promise<void> | null = null

function loadJitsiScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise
  if (window.JitsiMeetExternalAPI) return Promise.resolve()

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://${JITSI_DOMAIN}/external_api.js`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Jitsi external_api.js yüklənmədi — şəbəkəni yoxlayın'))
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export default function JitsiMeet({
  roomName,
  displayName,
  avatarUrl,
  onLeave,
  onError,
}: JitsiMeetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<JitsiApi | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let disposed = false

    async function initJitsi() {
      if (!containerRef.current) return

      try {
        await loadJitsiScript()

        if (disposed || !containerRef.current) return
        if (!window.JitsiMeetExternalAPI) {
          throw new Error('JitsiMeetExternalAPI mövcud deyil')
        }

        const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName,
          parentNode: containerRef.current,
          configOverwrite: {
            // Of Course brand mənşəli otaqlar üçün konfiqurasiya
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            prejoinPageEnabled: false, // birbaşa otağa daxil ol — əlavə Jitsi login yox
            disableDeepLinking: true, // mobil applara yönləndirmə yox
            // Görünüşü sadələşdir — lobbini söndür (artıq RLS təmin edir)
            enableLobby: false,
            requireDisplayName: false,
            // Jitsi branding-i gizlətmək cəhdi (public server məhdudiyyəti var)
            showBrandWatermark: false,
            // Toolbar-dakı "Jitsi" loqosu və kömək düyməsi
            toolbarButtons: [
              'microphone', 'camera', 'desktop', 'fullscreen',
              'fodeviceselection', 'hangup', 'chat', 'settings',
              'raisehand', 'filmstrip',
            ],
          },
          interfaceConfigOverwrite: {
            // Jitsi-nin default zoom/random avatar-larını söndür
            SHOW_JITSI_WATERMARK: false,       // əsas video sahasındaki loqo
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,       // marka su damgası
            SHOW_POWERED_BY: false,            // "Powered by Jitsi" mətni
            BRAND_WATERMARK_LINK: '',
            JITSI_WATERMARK_LINK: '',
          },
          userInfo: {
            displayName,
            ...(avatarUrl ? { avatarUrl } : {}),
          },
        })

        if (disposed) {
          api.dispose()
          return
        }

        apiRef.current = api
        setStatus('ready')

        // Hadisə dinləyiciləri
        api.addEventListeners({
          videoConferenceLeft: () => {
            if (!disposed && onLeave) onLeave()
          },
          participantLeft: () => {
            // başqa iştirakçı çıxdı — heç nə etməyə ehtiyac yox
          },
        })
      } catch (err: unknown) {
        if (disposed) return
        const msg = err instanceof Error ? err.message : 'Jitsi başlatıla bilmədi'
        setErrorMsg(msg)
        setStatus('error')
        if (onError) onError(msg)
      }
    }

    void initJitsi()

    return () => {
      disposed = true
      if (apiRef.current) {
        try {
          apiRef.current.dispose()
        } catch {
          // dispose-u təkrar çağırmaq xəta verə bilər — gözardı edirik
        }
        apiRef.current = null
      }
    }
  }, [roomName, displayName, avatarUrl, onLeave, onError])

  return (
    <div className="relative w-full h-full">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#fbf9ff] text-[#7022bd]">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ead8ff] border-t-[#7022bd]" />
            <p className="mt-3 text-sm">Video otağa qoşulur...</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#fbf9ff] p-6">
          <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm font-semibold text-red-700">Video bağlantısı xətası</p>
            <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-full bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700"
            >
              Yenidən cəhd et
            </button>
          </div>
        </div>
      )}

      {/* Jitsi iframe-i burada render olunur */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ minHeight: '400px' }}
      />
    </div>
  )
}
