/**
 * LessonRoom — tam ekran video dərs otağı səhifəsi.
 *
 * Route: /lessons/:requestId/room
 *
 * Workflow:
 * 1. URL-dən requestId oxuyur
 * 2. useLessonRoom hook-u ilə otaq məlumatlarını əldə edir
 * 3. Dərs `start_lesson` RPC-i ilə başladılır (server tərəfindən vaxt qeyd olunur)
 * 4. Countdown timer server vaxtına əsaslanır (səhifə yenilənsə də sıfırlanmır)
 * 5. Vaxt bitəndə `complete_lesson` RPC-i çağrılır (server kredit köçürür)
 * 6. "Çıxış" düyməsi — /sessions səhifəsinə qayıdır
 *
 * Təhlükəsizlik:
 * - Kredit köçürülməsi yalnız server tərəfindən (complete_lesson RPC)
 * - Timer yalnız göstəriş üçündür — kreditə qərar vermir
 * - complete_lesson vaxt yoxlaması edir (dərs müddəti tamamlanmalıdır)
 */

import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLessonRoom } from '../hooks/useLessonRoom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'
import JitsiMeet from '../components/JitsiMeet'

function formatTime(seconds: number): string {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function LessonRoom() {
  const { requestId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()

  const parsedRequestId = requestId ? Number(requestId) : null
  const { loading, error, roomName, lessonRequest, isParticipant, timing, refreshTiming } =
    useLessonRoom(parsedRequestId)

  // Countdown timer state — server vaxtına əsaslanır
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [lessonStarted, setLessonStarted] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completeMessage, setCompleteMessage] = useState('')

  // Dərsi başlat və complete_lesson çağır — inline olaraq effect-lərdə

  // Timing məlumatları gələndə timer-i yenilə
  useEffect(() => {
    if (!timing) return

    const captured = timing // null-yoxlamadan sonra capture et

    // Pattern C: inner async funksiya içində setState
    async function applyTiming() {
      await Promise.resolve()
      setRemainingSeconds(captured.remaining_seconds)
      if (captured.lesson_started_at && !lessonStarted) {
        setLessonStarted(true)
      }
    }
    void applyTiming()
  }, [timing, lessonStarted])

  // Otağa qoşulanda iştirakçı mark_joined çağırır
  // (hər iki iştirakçı qoşulanda lesson_started_at avtomatik set olunur)
  useEffect(() => {
    if (!roomName || !isParticipant || lessonRequest?.status !== 'accepted') {
      return
    }

    let cancelled = false

    async function markJoined() {
      const { error: joinErr } = await supabase.rpc('mark_joined', {
        p_request_id: parsedRequestId,
      })
      if (cancelled) return
      if (joinErr) {
        console.error('mark_joined error:', joinErr.message)
      } else {
        setLessonStarted(true)
        await refreshTiming()
      }
    }

    void markJoined()

    return () => {
      cancelled = true
    }
  }, [roomName, isParticipant, lessonRequest, parsedRequestId, refreshTiming])

  // İştirakçı otağı tərk edəndə mark_left çağır (attendance tracking)
  useEffect(() => {
    if (!roomName || !isParticipant) return

    const handleLeave = () => {
      void supabase.rpc('mark_left', { p_request_id: parsedRequestId })
    }

    // Səhifə bağlananda / navigate edəndə mark_left çağır
    window.addEventListener('beforeunload', handleLeave)

    return () => {
      window.removeEventListener('beforeunload', handleLeave)
      handleLeave()
    }
  }, [roomName, isParticipant, parsedRequestId])

  // Heartbeat — hər 30 saniyə serverə siqnal göndər
  // Bu, attendance tracking üçün etibarlı metod (beforeunload yalnız fallback)
  useEffect(() => {
    if (!roomName || !isParticipant || lessonRequest?.status !== 'accepted') return

    const interval = setInterval(() => {
      void supabase.rpc('heartbeat', { p_request_id: parsedRequestId })
    }, 30000) // 30 saniyə

    return () => clearInterval(interval)
  }, [roomName, isParticipant, lessonRequest, parsedRequestId])

  // Countdown timer — hər saniyə yenilə
  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return
    const interval = setInterval(() => {
      setRemainingSeconds(prev => (prev !== null ? Math.max(0, prev - 1) : null))
    }, 1000)
    return () => clearInterval(interval)
  }, [remainingSeconds])

  // Vaxt bitəndə — server tərəfindən tamamlanma gözlənilir
  // CRITICAL: complete_lesson RPC artıq authenticated-a bağlıdır (migration 15).
  // Kredit köçürülməsi yalnız pg_cron (auto_complete_expired_lessons) tərəfindən baş verir.
  // Frontend yalnız status göstərir — kreditə qərar vermir.
  useEffect(() => {
    if (remainingSeconds !== 0 || lessonRequest?.status !== 'accepted' || completing) {
      return
    }

    let cancelled = false

    async function waitForServerCompletion() {
      setCompleting(true)
      setCompleteMessage(t('liveLesson.waitingForServer'))

      // Server tərəfindən tamamlanmanı gözlə (cron hər dəqiqə işləyir)
      // 5 dəqiqə ərzində hər 30 saniyə timing-i yenilə
      for (let i = 0; i < 10; i++) {
        if (cancelled) return
        await new Promise(resolve => setTimeout(resolve, 30000))
        if (cancelled) return
        await refreshTiming()
        if (cancelled) return
        // Əgər status dəyişibsə (completed/pending_review) — mesajı yenilə
        if (timing?.status === 'completed') {
          setCompleteMessage(t('liveLesson.completedMsg'))
          setCompleting(false)
          return
        }
        if (timing?.status === 'pending_review') {
          setCompleteMessage(t('liveLesson.pendingReview'))
          setCompleting(false)
          return
        }
      }

      // 5 dəqiqə sonra hələ də gözləyirsə — timeout mesajı
      if (!cancelled) {
        setCompleteMessage(t('liveLesson.serverTimeout'))
        setCompleting(false)
      }
    }

    void waitForServerCompletion()

    return () => {
      cancelled = true
    }
  }, [remainingSeconds, lessonRequest, completing, parsedRequestId, refreshTiming, timing, t])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf9ff]">
        <div className="text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-[#ead8ff] border-t-[#7022bd]" />
          <p className="mt-4 text-sm text-[#7022bd]">{t('liveLesson.loading')}</p>
        </div>
      </div>
    )
  }

  if (error || !isParticipant || !lessonRequest) {
    // Log unauthorized access attempt
    if (lessonRequest && !isParticipant) {
      void supabase.rpc('log_security_event', {
        p_event_type: 'unauthorized_room_access',
        p_resource_type: 'lesson_room',
        p_resource_id: String(parsedRequestId),
        p_severity: 'warning',
      })
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf9ff] p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-bold text-[#281078]">
            {t('liveLesson.accessDenied')}
          </h1>
          <p className="mt-2 text-sm text-[#60477f]">
            {error ?? t('liveLesson.accessDeniedMsg')}
          </p>
          <p className="mt-3 text-xs text-[#a18bb8]">
            {t('liveLesson.accessDeniedHelp')}
          </p>
          <button
            onClick={() => navigate('/sessions', { replace: true })}
            className="mt-6 rounded-full bg-[#7022bd] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5d1ba0]"
          >
            {t('liveLesson.backToSessions')}
          </button>
        </div>
      </div>
    )
  }

  // Yalnız 'accepted' statuslu dərslər üçün otağa icazə veririk
  // (completed olanda artıq video dərs yoxdur)
  if (lessonRequest.status !== 'accepted') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf9ff] p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-[#281078]">
            {t('liveLesson.notAcceptedTitle')}
          </h1>
          <p className="mt-2 text-sm text-[#60477f]">
            {t('liveLesson.notAcceptedMsg')}
          </p>
          <button
            onClick={() => navigate('/sessions', { replace: true })}
            className="mt-6 rounded-full bg-[#7022bd] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5d1ba0]"
          >
            {t('liveLesson.backToSessions')}
          </button>
        </div>
      </div>
    )
  }

  if (!roomName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf9ff] p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#60477f]">{t('liveLesson.roomError')}</p>
          <button
            onClick={() => navigate('/sessions', { replace: true })}
            className="mt-6 rounded-full bg-[#7022bd] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5d1ba0]"
          >
            {t('liveLesson.backToSessions')}
          </button>
        </div>
      </div>
    )
  }

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'İstifadəçi'
  const avatarUrl = user?.user_metadata?.avatar_url

  return (
    <div className="flex h-screen flex-col bg-[#1a0a3a]">
      {/* Header — Of Course branding + countdown timer + back button */}
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="Of Course"
            className="h-7 w-7 rounded-full bg-white object-contain p-0.5"
          />
          <span className="text-sm font-bold text-white">Of Course Live</span>
        </div>

        {/* Countdown timer — server vaxtına əsaslanır */}
        <div className="flex items-center gap-3">
          {remainingSeconds !== null && (
            <div
              className={`rounded-full px-4 py-1.5 text-sm font-bold tabular-nums ${
                remainingSeconds <= 0
                  ? 'bg-green-500/20 text-green-300'
                  : remainingSeconds < 300
                  ? 'bg-red-500/20 text-red-300 animate-pulse'
                  : 'bg-white/10 text-white'
              }`}
            >
              {remainingSeconds <= 0
                ? t('liveLesson.completed')
                : `⏱ ${formatTime(remainingSeconds)}`}
            </div>
          )}

          {completeMessage && (
            <span className="text-xs font-semibold text-green-300">{completeMessage}</span>
          )}

          <button
            onClick={() => navigate('/sessions', { replace: true })}
            className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            ← {t('liveLesson.leaveRoom')}
          </button>
        </div>
      </header>

      {/* Video area — JitsiMeet tam ekran */}
      <div className="flex-1 overflow-hidden p-2">
        <JitsiMeet
          roomName={roomName}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onLeave={() => navigate('/sessions', { replace: true })}
          onError={(msg) => console.error('Jitsi error:', msg)}
        />
      </div>
    </div>
  )
}
