
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'

type SessionRow = {
  id: number
  requester_id: string
  teacher_id: string
  duration_hours: number
  scheduled_at: string | null
  completed_at: string | null
  status: 'accepted' | 'completed'
  requester: {
    id: string
    full_name: string
    avatar_url: string | null
  } | null
  teacher: {
    id: string
    full_name: string
    avatar_url: string | null
  } | null
  skill: {
    id: number
    name: string
    category: string
  } | null
}

// Supabase sorğu helper-i (setState yoxdur — komponent xaricində təmiz funksiya)
function fetchSessions(userId: string) {
  return supabase
    .from('lesson_requests')
    .select(`
      id,
      requester_id,
      teacher_id,
      duration_hours,
      scheduled_at,
      completed_at,
      status,
      requester:profiles!lesson_requests_requester_id_fkey (
        id,
        full_name,
        avatar_url
      ),
      teacher:profiles!lesson_requests_teacher_id_fkey (
        id,
        full_name,
        avatar_url
      ),
      skill:skills (
        id,
        name,
        category
      )
    `)
    .or(`requester_id.eq.${userId},teacher_id.eq.${userId}`)
    .in('status', ['accepted', 'completed'])
    .order('created_at', { ascending: false })
}

// Dil kodu → toLocaleString locale kodu
const DATE_LOCALES: Record<string, string> = {
  az: 'az-AZ',
  en: 'en-GB',
  ru: 'ru-RU',
  tr: 'tr-TR',
}

function Sessions() {
  const { user } = useAuth()
  const { t, i18n } = useTranslation()

  const dateLocale = DATE_LOCALES[i18n.resolvedLanguage ?? 'az'] ?? 'az-AZ'

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  // react.dev tövsiyəsi: fetch funksiyası effect daxilində,
  // bütün setState çağırışları await-dən SONRA olur
  useEffect(() => {
    if (!user) return

    let ignore = false
    const userId = user.id

    async function loadSessions() {
      const { data, error } = await fetchSessions(userId)

      if (ignore) return

      if (error) {
        setPageError(error.message)
        setLoading(false)
        return
      }

      setSessions(((data ?? []) as unknown) as SessionRow[])
      setLoading(false)
    }

    void loadSessions()

    return () => {
      ignore = true
    }
  }, [user])

  const upcoming = sessions
    .filter(session => session.status === 'accepted')
    .sort((a, b) => {
      if (!a.scheduled_at) return 1
      if (!b.scheduled_at) return -1

      return a.scheduled_at.localeCompare(b.scheduled_at)
    })

  const past = sessions.filter(session => session.status === 'completed')

  function getOtherPerson(session: SessionRow) {
    return session.teacher_id === user?.id
      ? session.requester
      : session.teacher
  }

  function isUserTeacher(session: SessionRow) {
    return session.teacher_id === user?.id
  }

  function formatDateTime(value: string | null) {
    if (!value) return t('sessions.dateNotSet')

    return new Date(value).toLocaleString(dateLocale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function renderSessionCard(session: SessionRow, isPast: boolean) {
    const other = getOtherPerson(session)
    const role = isUserTeacher(session)
      ? t('sessions.roleTeacher')
      : t('sessions.roleStudent')
    const otherRole = isUserTeacher(session)
      ? t('sessions.roleStudent')
      : t('sessions.roleTeacher')

    return (
      <article
        key={session.id}
        className="rounded-2xl border border-[#ecd1f6] bg-white px-5 py-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  isPast
                    ? 'bg-purple-50 text-purple-700'
                    : 'bg-[#dcfce7] text-green-700'
                }`}
              >
                {isPast ? t('sessions.badgeCompleted') : t('sessions.badgeScheduled')}
              </span>
              <span className="rounded-full bg-[#f4e1fb] px-2.5 py-1 text-[10px] font-semibold text-[#8b20d5]">
                {role}
              </span>
            </div>

            <h3 className="mt-2 text-sm font-bold text-[#24105c]">
              {session.skill?.name ?? t('sessions.session')}
            </h3>

            <p className="mt-1 text-[11px] text-[#8065a8]">
              {t('sessions.personRole', {
                role: otherRole,
                name: other?.full_name || t('sessions.user'),
              })}
              {' · '}
              {t('sessions.durationOf', { count: session.duration_hours })}
            </p>

            <p className="mt-1 text-[11px] text-[#604c85]">
              {isPast
                ? t('sessions.completedAt', {
                    date: formatDateTime(session.completed_at),
                  })
                : t('sessions.scheduledAt', {
                    date: formatDateTime(session.scheduled_at),
                  })}
            </p>
          </div>
        </div>
      </article>
    )
  }

  return (
    <main className="min-h-screen bg-white px-4 py-8 text-[#291078] sm:py-12">
      <div className="mx-auto max-w-[1000px]">

        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold sm:text-3xl">{t('sessions.title')}</h1>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-6 text-[#796b9e] sm:text-sm">
            {t('sessions.subtitle')}
          </p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#8065a8]">{t('sessions.loading')}</p>
        ) : (
          <>
            {pageError && (
              <div className="mx-auto mb-6 max-w-xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-xs text-red-600">
                {pageError}
              </div>
            )}

            {/* PLANLAŞDIRILAN */}
            <section>
              <h2 className="mb-4 text-lg font-bold">
                {t('sessions.scheduledTitle')} ({upcoming.length})
              </h2>

              {upcoming.length === 0 ? (
                <div className="rounded-2xl border border-[#ecd1f6] bg-[#fbf0fd] px-6 py-8 text-center">
                  <p className="text-sm text-[#8065a8]">
                    {t('sessions.emptyScheduledPre')}{' '}
                    <Link to="/skills" className="font-semibold text-[#8b20d5] underline">
                      {t('nav.skills')}
                    </Link>{' '}
                    {t('sessions.emptyScheduledPost')}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcoming.map(session => renderSessionCard(session, false))}
                </div>
              )}
            </section>

            {/* TAMAMLANAN */}
            <section className="mt-10">
              <h2 className="mb-4 text-lg font-bold">
                {t('sessions.completedTitle')} ({past.length})
              </h2>

              {past.length === 0 ? (
                <div className="rounded-2xl border border-[#ecd1f6] bg-[#fbf0fd] px-6 py-8 text-center">
                  <p className="text-sm text-[#8065a8]">
                    {t('sessions.emptyCompleted')}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {past.map(session => renderSessionCard(session, true))}
                </div>
              )}
            </section>

            <p className="mt-10 text-center text-xs text-[#8065a8]">
              {t('sessions.footerPre')}{' '}
              <Link to="/requests" className="font-semibold text-[#8b20d5] underline">
                {t('nav.requests')}
              </Link>{' '}
              {t('sessions.footerPost')}
            </p>
          </>
        )}
      </div>
    </main>
  )
}

export default Sessions
