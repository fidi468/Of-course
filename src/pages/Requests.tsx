
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

type RequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'cancelled'

type LessonRequest = {
  id: number
  requester_id: string
  teacher_id: string
  skill_id: number
  duration_hours: number
  message: string | null
  scheduled_at: string | null
  status: RequestStatus
  created_at: string
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
async function fetchLessonRequests(userId: string) {
  return supabase
    .from('lesson_requests')
    .select(`
      id,
      requester_id,
      teacher_id,
      skill_id,
      duration_hours,
      message,
      scheduled_at,
      status,
      created_at,
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
    .order('created_at', { ascending: false })
}

const statusLabels: Record<RequestStatus, string> = {
  pending: 'Gözləyir',
  accepted: 'Qəbul edilib',
  rejected: 'Rədd edilib',
  completed: 'Tamamlanıb',
  cancelled: 'Ləğv edilib',
}

const statusStyles: Record<RequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
  completed: 'bg-purple-50 text-purple-700 border-purple-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
}

function Requests() {
  const { user } = useAuth()

  const [requests, setRequests] = useState<LessonRequest[]>([])
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>(
    'incoming'
  )
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [actionError, setActionError] = useState('')
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [successMessage, setSuccessMessage] = useState('')

  // Əməliyyatlardan sonra siyahını səssiz yeniləyir (loading-i yenidən true etmir)
  const loadRequests = useCallback(async () => {
    if (!user) return

    const { data, error } = await fetchLessonRequests(user.id)

    if (error) {
      setPageError(error.message)
      setLoading(false)
      return
    }

    setRequests((data ?? []) as unknown as LessonRequest[])
    setLoading(false)
  }, [user])

  // react.dev tövsiyəsi: fetch funksiyası effect daxilində,
  // bütün setState çağırışları await-dən SONRA olur
  useEffect(() => {
    if (!user) return

    let ignore = false
    const userId = user.id

    async function fetchRequests() {
      const { data, error } = await fetchLessonRequests(userId)

      if (ignore) return

      if (error) {
        setPageError(error.message)
        setLoading(false)
        return
      }

      setRequests((data ?? []) as unknown as LessonRequest[])
      setLoading(false)
    }

    void fetchRequests()

    return () => {
      ignore = true
    }
  }, [user])

  const incomingRequests = requests.filter(
    request => request.teacher_id === user?.id
  )

  const outgoingRequests = requests.filter(
    request => request.requester_id === user?.id
  )

  const visibleRequests =
    activeTab === 'incoming' ? incomingRequests : outgoingRequests

  async function handleRespond(requestId: number, accept: boolean) {
    if (processingId !== null) return

    setProcessingId(requestId)
    setActionError('')
    setSuccessMessage('')

    try {
      const { error } = await supabase.rpc('respond_to_request', {
        p_request_id: requestId,
        p_accept: accept,
      })

      if (error) {
        setActionError(error.message)
      } else {
        setSuccessMessage(
          accept ? 'Sorğu qəbul edildi!' : 'Sorğu rədd edildi.'
        )
        await loadRequests()
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Gözlənilməz xəta baş verdi. Yenidən cəhd et.'
      )
    } finally {
      setProcessingId(null)
    }
  }

  async function handleCancel(requestId: number) {
    if (processingId !== null) return

    const confirmed = window.confirm(
      'Bu dərs sorğusunu ləğv etmək istəyirsən?'
    )

    if (!confirmed) return

    setProcessingId(requestId)
    setActionError('')
    setSuccessMessage('')

    try {
      const { error } = await supabase.rpc('cancel_request', {
        p_request_id: requestId,
      })

      if (error) {
        setActionError(error.message)
      } else {
        setSuccessMessage('Sorğu ləğv edildi.')
        await loadRequests()
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Gözlənilməz xəta baş verdi. Yenidən cəhd et.'
      )
    } finally {
      setProcessingId(null)
    }
  }

  async function handleComplete(requestId: number) {
    if (processingId !== null) return

    const confirmed = window.confirm(
      'Bu dərsin tamamlandığını təsdiqləyirsən? Kreditlər tərəflərin balansına köçürüləcək.'
    )

    if (!confirmed) return

    setProcessingId(requestId)
    setActionError('')
    setSuccessMessage('')

    try {
      const { error } = await supabase.rpc('complete_lesson', {
        p_request_id: requestId,
      })

      if (error) {
        setActionError(error.message)
      } else {
        setSuccessMessage('Dərs tamamlandı və kreditlər köçürüldü!')
        await loadRequests()
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Gözlənilməz xəta baş verdi. Yenidən cəhd et.'
      )
    } finally {
      setProcessingId(null)
    }
  }

  function formatDate(value: string | null) {
    if (!value) return 'Tarix təyin edilməyib'

    return new Date(value).toLocaleString('az-AZ', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getPerson(request: LessonRequest) {
    return activeTab === 'incoming'
      ? request.requester
      : request.teacher
  }

  return (
    <main className="min-h-screen bg-white px-4 py-8 text-[#291078] sm:py-12">
      <div className="mx-auto max-w-[1000px]">

        {/* Header */}
        <div className="text-center">
          <span className="inline-block rounded-full bg-[#f4e1fb] px-4 py-1.5 text-[10px] font-semibold text-[#8b20d5]">
            Of Course · Dərs idarəetməsi
          </span>

          <h1 className="mt-4 text-3xl font-bold sm:text-4xl">
            Sorğularım
          </h1>

          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-[#8065a8] sm:text-sm">
            Dərs müraciətlərini idarə et, yeni biliklər paylaş və
            öyrənmə səyahətini davam etdir.
          </p>
        </div>

        {/* Statistics */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#ead0f6] bg-[#faf4fd] p-4">
            <p className="text-[10px] text-[#8065a8]">Gələn sorğular</p>
            <p className="mt-2 text-2xl font-bold text-[#861bd2]">
              {incomingRequests.length}
            </p>
          </div>

          <div className="rounded-2xl border border-[#ead0f6] bg-[#faf4fd] p-4">
            <p className="text-[10px] text-[#8065a8]">Göndərilən sorğular</p>
            <p className="mt-2 text-2xl font-bold text-[#861bd2]">
              {outgoingRequests.length}
            </p>
          </div>

          <div className="col-span-2 rounded-2xl border border-[#ead0f6] bg-[#faf4fd] p-4 sm:col-span-1">
            <p className="text-[10px] text-[#8065a8]">Gözləyən sorğular</p>
            <p className="mt-2 text-2xl font-bold text-[#861bd2]">
              {requests.filter(r => r.status === 'pending').length}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-8 flex gap-2 rounded-xl bg-[#f8effd] p-1.5">
          <button
            onClick={() => {
              setActiveTab('incoming')
              setActionError('')
              setSuccessMessage('')
            }}
            className={`flex-1 rounded-lg px-3 py-3 text-xs font-semibold transition ${
              activeTab === 'incoming'
                ? 'bg-white text-[#861bd2] shadow-sm'
                : 'text-[#8065a8] hover:text-[#861bd2]'
            }`}
          >
            Gələn sorğular ({incomingRequests.length})
          </button>

          <button
            onClick={() => {
              setActiveTab('outgoing')
              setActionError('')
              setSuccessMessage('')
            }}
            className={`flex-1 rounded-lg px-3 py-3 text-xs font-semibold transition ${
              activeTab === 'outgoing'
                ? 'bg-white text-[#861bd2] shadow-sm'
                : 'text-[#8065a8] hover:text-[#861bd2]'
            }`}
          >
            Göndərdiklərim ({outgoingRequests.length})
          </button>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-700">
            ✓ {successMessage}
          </div>
        )}

        {actionError && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
            {actionError}
          </div>
        )}

        {/* Request list */}
        <section className="mt-6">
          {loading ? (
            <div className="py-16 text-center text-sm text-[#8065a8]">
              Sorğular yüklənir...
            </div>
          ) : pageError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-xs text-red-600">
              Sorğuları yükləmək mümkün olmadı: {pageError}
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#e6c8f2] bg-[#fcf8fe] px-5 py-16 text-center">
              <div className="text-3xl">✉</div>

              <h2 className="mt-4 text-base font-bold">
                Hələ sorğu yoxdur
              </h2>

              <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#8065a8]">
                {activeTab === 'incoming'
                  ? 'Sənə yeni dərs müraciəti göndərildikdə burada görünəcək.'
                  : 'Göndərdiyin dərs müraciətləri burada görünəcək.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visibleRequests.map(request => {
                const person = getPerson(request)
                const isPending = request.status === 'pending'
                const isAccepted = request.status === 'accepted'
                const isProcessing = processingId === request.id

                return (
                  <article
                    key={request.id}
                    className="rounded-2xl border border-[#ead0f6] bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <span className="rounded-full bg-[#f4e1fb] px-3 py-1 text-[9px] font-semibold text-[#8b20d5]">
                          {request.skill?.category ?? 'Bacarıq'}
                        </span>

                        <h2 className="mt-3 text-lg font-bold">
                          {request.skill?.name ?? 'Dərs'}
                        </h2>
                      </div>

                      <span
                        className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${
                          statusStyles[request.status]
                        }`}
                      >
                        {statusLabels[request.status]}
                      </span>
                    </div>

                    {/* Person */}
                    <div className="mt-5 flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f0dcfa] text-sm font-bold text-[#861bd2]">
                        {person?.avatar_url ? (
                          <img
                            src={person.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (person?.full_name || '?')
                            .charAt(0)
                            .toUpperCase()
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold">
                          {person?.full_name || 'İstifadəçi'}
                        </p>

                        <p className="mt-1 text-[10px] text-[#8065a8]">
                          {activeTab === 'incoming'
                            ? 'Səndən dərs almaq istəyir'
                            : 'Dərs almaq istədiyin müəllim'}
                        </p>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl bg-[#faf4fd] p-4 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] text-[#8065a8]">
                          Seans müddəti
                        </p>
                        <p className="mt-1 text-xs font-semibold">
                          {request.duration_hours} saat
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] text-[#8065a8]">
                          Kredit
                        </p>
                        <p className="mt-1 text-xs font-semibold">
                          {request.duration_hours} kredit
                        </p>
                      </div>

                      <div className="sm:col-span-2">
                        <p className="text-[10px] text-[#8065a8]">
                          Seans vaxtı
                        </p>
                        <p className="mt-1 text-xs font-semibold">
                          {formatDate(request.scheduled_at)}
                        </p>
                      </div>
                    </div>

                    {/* Message */}
                    {request.message && (
                      <div className="mt-4 rounded-xl border border-[#f0e2f7] p-4">
                        <p className="text-[10px] font-semibold text-[#8065a8]">
                          Mesaj
                        </p>
                        <p className="mt-2 text-xs leading-5 text-[#604c85]">
                          {request.message}
                        </p>
                      </div>
                    )}

                    <div className="mt-4 text-[10px] text-[#a18bb8]">
                      Göndərilmə tarixi: {formatDate(request.created_at)}
                    </div>

                    {/* Actions */}
                    <div className="mt-5 flex flex-wrap gap-2">
                      {activeTab === 'incoming' && isPending && (
                        <>
                          <button
                            disabled={processingId !== null}
                            onClick={() => handleRespond(request.id, true)}
                            className="flex-1 rounded-xl bg-[#861bd2] px-4 py-3 text-xs font-semibold text-white transition hover:bg-[#7015b5] disabled:opacity-50"
                          >
                            {isProcessing ? 'Gözlə...' : 'Qəbul et'}
                          </button>

                          <button
                            disabled={processingId !== null}
                            onClick={() => handleRespond(request.id, false)}
                            className="flex-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                          >
                            Rədd et
                          </button>
                        </>
                      )}

                      {activeTab === 'incoming' && isAccepted && (
                        <button
                          disabled={processingId !== null}
                          onClick={() => handleComplete(request.id)}
                          className="flex-1 rounded-xl bg-green-600 px-4 py-3 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                        >
                          {isProcessing
                            ? 'Gözlə...'
                            : 'Dərsi tamamla'}
                        </button>
                      )}

                      {(isPending || isAccepted) && (
                        <button
                          disabled={processingId !== null}
                          onClick={() => handleCancel(request.id)}
                          className="rounded-xl border border-[#e8b9f7] px-4 py-3 text-xs font-semibold text-[#8065a8] transition hover:bg-[#faf4fd] disabled:opacity-50"
                        >
                          Ləğv et
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* Footer note */}
        <div className="mt-8 rounded-xl border border-[#ead0f6] bg-[#faf4fd] p-4">
          <p className="text-[10px] leading-5 text-[#8065a8]">
            <strong className="text-[#861bd2]">Qeyd:</strong> Kreditlər
            sorğu göndərildikdə deyil, müəllim dərsi tamamladıqda
            iştirakçıların balansları arasında köçürülür.
          </p>
        </div>
      </div>
    </main>
  )
}

export default Requests
