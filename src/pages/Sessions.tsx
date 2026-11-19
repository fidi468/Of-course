
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

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

function formatDateTime(value: string | null) {
  if (!value) return 'Tarix təyin edilməyib'

  return new Date(value).toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Sessions() {
  const { user } = useAuth()

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

  function getRoleLabel(session: SessionRow) {
    return session.teacher_id === user?.id ? 'Müəllim' : 'Şagird'
  }

  function renderSessionCard(session: SessionRow, isPast: boolean) {
    const other = getOtherPerson(session)

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
                {isPast ? 'Tamamlanıb' : 'Planlaşdırılıb'}
              </span>
              <span className="rounded-full bg-[#f4e1fb] px-2.5 py-1 text-[10px] font-semibold text-[#8b20d5]">
                {getRoleLabel(session)}
              </span>
            </div>

            <h3 className="mt-2 text-sm font-bold text-[#24105c]">
              {session.skill?.name ?? 'Seans'}
            </h3>

            <p className="mt-1 text-[11px] text-[#8065a8]">
              {session.teacher_id === user?.id ? 'Şagird' : 'Müəllim'}:{' '}
              {other?.full_name || 'İstifadəçi'} · Müddət: {session.duration_hours} saat
            </p>

            <p className="mt-1 text-[11px] text-[#604c85]">
              {isPast
                ? `Bitib: ${formatDateTime(session.completed_at)}`
                : `Vaxt: ${formatDateTime(session.scheduled_at)}`}
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
          <h1 className="text-2xl font-bold sm:text-3xl">Seanslarım</h1>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-6 text-[#796b9e] sm:text-sm">
            Təsdiqlənmiş və tamamlanmış dərs seanslarının cədvəli.
          </p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#8065a8]">Seanslar yüklənir...</p>
        ) : (
          <>
            {pageError && (
              <div className="mx-auto mb-6 max-w-xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-xs text-red-600">
                {pageError}
              </div>
            )}

            {/* PLANLAŞDIRILAN */}
            <section>
              <h2 className="mb-4 text-lg font-bold">Planlaşdırılan seanslar ({upcoming.length})</h2>

              {upcoming.length === 0 ? (
                <div className="rounded-2xl border border-[#ecd1f6] bg-[#fbf0fd] px-6 py-8 text-center">
                  <p className="text-sm text-[#8065a8]">
                    Planlaşdırılan seans yoxdur. Yeni seans üçün{' '}
                    <Link to="/skills" className="font-semibold text-[#8b20d5] underline">
                      Bacarıqlar
                    </Link>{' '}
                    səhifəsindən müəllimə sorğu göndər.
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
              <h2 className="mb-4 text-lg font-bold">Tamamlanan seanslar ({past.length})</h2>

              {past.length === 0 ? (
                <div className="rounded-2xl border border-[#ecd1f6] bg-[#fbf0fd] px-6 py-8 text-center">
                  <p className="text-sm text-[#8065a8]">
                    Hələ tamamlanan seans yoxdur.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {past.map(session => renderSessionCard(session, true))}
                </div>
              )}
            </section>

            <p className="mt-10 text-center text-xs text-[#8065a8]">
              Gələn sorğuları qəbul etmək və seansları tamamlamaq üçün{' '}
              <Link to="/requests" className="font-semibold text-[#8b20d5] underline">
                İstəklər
              </Link>{' '}
              səhifəsinə keç.
            </p>
          </>
        )}
      </div>
    </main>
  )
}

export default Sessions
