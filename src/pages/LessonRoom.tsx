/**
 * LessonRoom — tam ekran video dərs otağı səhifəsi.
 *
 * Route: /lessons/:requestId/room
 *
 * Workflow:
 * 1. URL-dən requestId oxuyur
 * 2. useLessonRoom hook-u ilə otaq məlumatlarını əldə edir
 * 3. İştirakçı deyilsə — xəta göstərir
 * 4. Otaq hazırdırsa — JitsiMeet komponentini render edir
 * 5. "Çıxış" düyməsi — /sessions səhifəsinə qayıdır
 *
 * Təhlükəsizlik:
 * - Bu səhifə ProtectedRoute içindədir (yalnız authenticated istifadəçi)
 * - useLessonRoom RLS vasitəsilə iştirakçı statusunu yoxlayır
 * - lessonRequest.status yalnız 'accepted' və ya 'completed' olduqda otağa icazə
 */

import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useLessonRoom } from '../hooks/useLessonRoom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'
import JitsiMeet from '../components/JitsiMeet'

export default function LessonRoom() {
  const { requestId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()

  const parsedRequestId = requestId ? Number(requestId) : null
  const { loading, error, roomName, lessonRequest, isParticipant } =
    useLessonRoom(parsedRequestId)

  // İştirakçı deyilsə və ya xəta varsa — sessions səhifəsinə yönləndir
  useEffect(() => {
    if (!loading && (!isParticipant || error) && !roomName) {
      // Yalnız icazəsiz cəhdi avtomatik yönləndir; xəta mesajını göstərmək üçün
      // navigate('/sessions', { replace: true }) — amma əvvəlcə xətanı göstərək
    }
  }, [loading, isParticipant, error, roomName])

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
      {/* Header — Of Course branding + back button */}
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="Of Course"
            className="h-7 w-7 rounded-full bg-white object-contain p-0.5"
          />
          <span className="text-sm font-bold text-white">Of Course Live</span>
        </div>

        <button
          onClick={() => navigate('/sessions', { replace: true })}
          className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          ← {t('liveLesson.leaveRoom')}
        </button>
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
