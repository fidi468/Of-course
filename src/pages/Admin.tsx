/**
 * Admin — moderator paneli (yalnız admin istifadəçilər üçün).
 *
 * Funksiyalar:
 * - Bütün şikayətləri görüntülə
 * - Şikayətləri həll et / dismiss et
 * - İstifadəçiləri dayandır / bərpa et
 * - İstifadəçiləri verify et
 *
 * Təhlükəsizlik:
 * - Bu səhifə ProtectedRoute içindədir
 * - Bütün əməliyyatlar RPC vasitəsilə server tərəfdən yoxlanılır
 * - Admin statusu profiles.is_admin sütunundan oxunur
 * - RPC-lər SECURITY DEFINER + admin yoxlaması edir
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useReports } from '../hooks/useReports'
import { useTranslation } from 'react-i18next'

type ProfileRow = {
  id: string
  full_name: string
  email: string | null
  trust_level: string
  is_suspended: boolean
  suspended_until: string | null
  suspended_reason: string | null
  created_at: string
}

export default function Admin() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const { reports, loading: reportsLoading, loadReports, resolveReport } = useReports()
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  useEffect(() => {
    void loadReports()
    void loadProfiles()
  }, [loadReports])

  async function loadProfiles() {
    setProfilesLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, trust_level, is_suspended, suspended_until, suspended_reason, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setActionError(error.message)
    } else {
      setProfiles((data ?? []) as ProfileRow[])
    }
    setProfilesLoading(false)
  }

  async function handleSuspend(userId: string) {
    const reason = window.prompt(t('admin.suspendReasonPrompt'))
    if (!reason) return

    const durationStr = window.prompt(t('admin.suspendDurationPrompt'), '24')
    const duration = durationStr ? parseInt(durationStr, 10) : null

    setActionError('')
    setActionSuccess('')

    const { error } = await supabase.rpc('suspend_user', {
      p_user_id: userId,
      p_duration_hours: duration,
      p_reason: reason,
    })

    if (error) {
      setActionError(error.message)
    } else {
      setActionSuccess(t('admin.suspendedSuccess'))
      void loadProfiles()
    }
  }

  async function handleUnsuspend(userId: string) {
    setActionError('')
    setActionSuccess('')

    const { error } = await supabase.rpc('unsuspend_user', {
      p_user_id: userId,
    })

    if (error) {
      setActionError(error.message)
    } else {
      setActionSuccess(t('admin.unsuspendedSuccess'))
      void loadProfiles()
    }
  }

  async function handleVerify(userId: string) {
    setActionError('')
    setActionSuccess('')

    const { error } = await supabase.rpc('verify_user', {
      p_user_id: userId,
    })

    if (error) {
      setActionError(error.message)
    } else {
      setActionSuccess(t('admin.verifiedSuccess'))
      void loadProfiles()
    }
  }

  async function handleResolve(reportId: number, status: 'resolved' | 'dismissed') {
    setActionError('')
    setActionSuccess('')

    const note = window.prompt(t('admin.resolutionNotePrompt')) ?? ''
    const { error } = await resolveReport(reportId, status, note)

    if (error) {
      setActionError(error)
    } else {
      setActionSuccess(t('admin.resolvedSuccess'))
    }
  }

  if (!user) return null

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-[#281078]">{t('admin.title')}</h1>
      <p className="mt-1 text-sm text-[#8065a8]">{t('admin.subtitle')}</p>

      {actionError && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {actionSuccess}
        </div>
      )}

      {/* Pending Review Lessons section — admin manual yoxlama */}
      <section className="mt-8">
        <h2 className="text-lg font-bold text-[#281078]">
          {t('admin.pendingReviewTitle')}
        </h2>
        <PendingReviewSection t={t} />
      </section>

      {/* Reports section */}
      <section className="mt-8">
        <h2 className="text-lg font-bold text-[#281078]">
          {t('admin.reportsTitle')} ({reports.length})
        </h2>

        {reportsLoading ? (
          <p className="mt-3 text-sm text-[#8065a8]">{t('common.loading')}</p>
        ) : reports.length === 0 ? (
          <p className="mt-3 text-sm text-[#8065a8]">{t('admin.noReports')}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {reports.map((report) => (
              <article
                key={report.id}
                className="rounded-xl border border-[#ead0f6] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-[#f4e1fb] px-2.5 py-0.5 text-[10px] font-semibold text-[#8b20d5]">
                      {report.reason}
                    </span>
                    <span
                      className={`ml-2 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                        report.status === 'pending'
                          ? 'bg-amber-50 text-amber-700'
                          : report.status === 'resolved'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {report.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleResolve(report.id, 'resolved')}
                          className="rounded-lg bg-green-600 px-3 py-1 text-[10px] font-semibold text-white hover:bg-green-700"
                        >
                          {t('admin.resolve')}
                        </button>
                        <button
                          onClick={() => handleResolve(report.id, 'dismissed')}
                          className="rounded-lg border border-gray-200 px-3 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          {t('admin.dismiss')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {report.description && (
                  <p className="mt-2 text-xs text-[#604c85]">{report.description}</p>
                )}
                <p className="mt-2 text-[10px] text-[#a18bb8]">
                  {new Date(report.created_at).toLocaleString()}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Users section */}
      <section className="mt-10">
        <h2 className="text-lg font-bold text-[#281078]">{t('admin.usersTitle')}</h2>

        {profilesLoading ? (
          <p className="mt-3 text-sm text-[#8065a8]">{t('common.loading')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#ead0f6] text-[#8065a8]">
                  <th className="py-2 pr-4 font-semibold">{t('admin.userName')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('admin.trustLevel')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('admin.status')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-[#f0e2f7]">
                    <td className="py-3 pr-4 font-medium text-[#281078]">
                      {profile.full_name || '—'}
                      <div className="text-[10px] text-[#a18bb8]">
                        {profile.id.slice(0, 8)}...
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          profile.trust_level === 'verified'
                            ? 'bg-blue-50 text-blue-700'
                            : profile.trust_level === 'trusted'
                            ? 'bg-purple-50 text-purple-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {profile.trust_level}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {profile.is_suspended ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                          {t('admin.suspended')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                          {t('admin.active')}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {profile.trust_level !== 'verified' && profile.id !== user.id && (
                          <button
                            onClick={() => handleVerify(profile.id)}
                            className="rounded-lg bg-blue-600 px-2 py-1 text-[9px] font-semibold text-white hover:bg-blue-700"
                          >
                            ✓ {t('admin.verify')}
                          </button>
                        )}
                        {!profile.is_suspended && profile.id !== user.id && (
                          <button
                            onClick={() => handleSuspend(profile.id)}
                            className="rounded-lg bg-red-600 px-2 py-1 text-[9px] font-semibold text-white hover:bg-red-700"
                          >
                            ⏸ {t('admin.suspend')}
                          </button>
                        )}
                        {profile.is_suspended && (
                          <button
                            onClick={() => handleUnsuspend(profile.id)}
                            className="rounded-lg border border-green-200 px-2 py-1 text-[9px] font-semibold text-green-700 hover:bg-green-50"
                          >
                            ▶ {t('admin.unsuspend')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

// =====================================================================
// PendingReviewSection — pending_review statuslu dərslərin admin paneli
// Migration 15-dəki get_pending_review_lessons və resolve_pending_lesson
// RPC-lərini istifadə edir.
// =====================================================================

type PendingReviewLesson = {
  lesson_request_id: number
  teacher_name: string
  student_name: string
  skill_name: string
  duration_hours: number
  lesson_started_at: string
  teacher_attendance_pct: number
  student_attendance_pct: number
  blocking_reason: string
}

function PendingReviewSection({ t }: { t: (key: string) => string }) {
  const [lessons, setLessons] = useState<PendingReviewLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadLessons() {
      const { data, error: err } = await supabase.rpc('get_pending_review_lessons')
      if (cancelled) return
      if (err) {
        setError(err.message)
      } else {
        setLessons((data ?? []) as PendingReviewLesson[])
      }
      setLoading(false)
    }

    void loadLessons()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleResolve(lessonId: number, action: 'complete' | 'cancel') {
    setActionLoading(lessonId)
    const { error: err } = await supabase.rpc('resolve_pending_lesson', {
      p_request_id: lessonId,
      p_action: action,
      p_note: null,
    })
    if (err) {
      setError(err.message)
    } else {
      // Reload after resolve
      const { data } = await supabase.rpc('get_pending_review_lessons')
      setLessons((data ?? []) as PendingReviewLesson[])
    }
    setActionLoading(null)
  }

  if (loading) return <p className="mt-3 text-sm text-[#8065a8]">{t('common.loading')}</p>
  if (error) return <p className="mt-3 text-sm text-red-600">{error}</p>
  if (lessons.length === 0)
    return <p className="mt-3 text-sm text-[#8065a8]">{t('admin.noPendingReview')}</p>

  return (
    <div className="mt-3 space-y-3">
      {lessons.map((lesson) => (
        <article
          key={lesson.lesson_request_id}
          className="rounded-xl border border-amber-200 bg-amber-50 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#281078]">
                {lesson.skill_name} — {lesson.duration_hours}h
              </h3>
              <p className="mt-1 text-xs text-[#604c85]">
                {t('admin.teacher')}: {lesson.teacher_name} ·{' '}
                {t('admin.student')}: {lesson.student_name}
              </p>
              <p className="mt-1 text-[10px] text-[#a18bb8]">
                {new Date(lesson.lesson_started_at).toLocaleString()}
              </p>
              <div className="mt-2 flex gap-4 text-[10px]">
                <span className="text-[#8065a8]">
                  {t('admin.teacherAttendance')}: {lesson.teacher_attendance_pct}%
                </span>
                <span className="text-[#8065a8]">
                  {t('admin.studentAttendance')}: {lesson.student_attendance_pct}%
                </span>
              </div>
              <p className="mt-1 text-[10px] font-semibold text-red-600">
                {t('admin.blockingReason')}: {lesson.blocking_reason}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                disabled={actionLoading === lesson.lesson_request_id}
                onClick={() => handleResolve(lesson.lesson_request_id, 'complete')}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {t('admin.approveCredit')}
              </button>
              <button
                disabled={actionLoading === lesson.lesson_request_id}
                onClick={() => handleResolve(lesson.lesson_request_id, 'cancel')}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {t('admin.cancelLesson')}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
