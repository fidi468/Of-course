/**
 * useLessonRoom — bir lesson_request üçün Jitsi otaq məlumatını əldə edir
 * və ya (yoxdursa) yaradır.
 *
 * Workflow:
 * 1. lesson_request-i yoxlayırıq (RLS yalnız iştirakçılara icazə verir)
 * 2. SERVER TƏRƏFLİ `ensure_lesson_room` RPC çağırır — atomik create-or-get
 *    (migration 16). RPC yoxdursa köhnə select→insert flow-a düşür.
 * 3. room_name qaytarır — JitsiMeet komponenti bunu istifadə edir
 *
 * Xəta klassifikasiyası:
 * - Bütün xətalar i18n açarı kimi qaytarılır (errorKey) — LessonRoom
 *   komponenti bunu t() ilə istifadəçinin dilində göstərir. Supabase-in
 *   ingiliscə xəta mətnləri birbaşa istifadəçiyə göstərilmir.
 * - "column does not exist" → bazada migration çatışmır → schemaMissing
 * - "row-level security / 0 rows" → icazə yoxdur → accessDeniedMsg
 * - digər → roomError
 *
 * Təhlükəsizlik:
 * - RLS yalnız iştirakçılara select/insert icazə verir
 * - ensure_lesson_room SECURITY DEFINER funksiyası iştirakçı + status
 *   yoxlamasını SERVER TƏRƏFİNDƏ aparır
 * - room_name təsadüfi UUID ilə generate olunur (proqnozlaşdırıla bilməz)
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './useAuth'
import type { PostgrestError } from '@supabase/supabase-js'

type LessonRoomRow = {
  id: number
  lesson_request_id: number
  room_name: string
  created_by: string
  created_at: string
}

type LessonRequestRow = {
  id: number
  requester_id: string
  teacher_id: string
  skill_id: number
  duration_hours: number
  status: string
  scheduled_at: string | null
  lesson_started_at: string | null
  lesson_ended_at: string | null
}

type LessonTiming = {
  status: string
  lesson_started_at: string | null
  lesson_ended_at: string | null
  duration_hours: number
  elapsed_seconds: number
  remaining_seconds: number
}

type UseLessonRoomResult = {
  loading: boolean
  /** i18n açarı — LessonRoom t() ilə tərcümə edir */
  errorKey: string | null
  roomName: string | null
  lessonRequest: LessonRequestRow | null
  isParticipant: boolean
  timing: LessonTiming | null
  refreshTiming: () => Promise<void>
}

/**
 * lesson_requests oxunma xətasını istifadəçi üçün anlaşılan i18n açarına
 * çevirir. PostgREST/Postgres xəta kodlarına baxır — xam ingiliscə mətn
 * istifadəçiyə heç vaxt göstərilmir.
 */
function classifyRequestError(err: PostgrestError | null | undefined): string {
  const code = (err?.code ?? '').toUpperCase()
  const msg = (err?.message ?? '').toLowerCase()

  // Sütun/sxema çatışmır → bazada migration tətbiq edilməyib
  if (
    code === 'PGRST204' ||
    code === '42703' ||
    (msg.includes('does not exist') && msg.includes('column')) ||
    (msg.includes('could not find the') && msg.includes('schema cache'))
  ) {
    return 'liveLesson.schemaMissing'
  }

  // RLS blokladı və ya sətir iştirakçıya görünmür
  if (
    code === '42501' ||
    code === 'PGRST116' ||
    msg.includes('row-level security')
  ) {
    return 'liveLesson.accessDeniedMsg'
  }

  // Digər (şəbəkə, sxema cache və s.)
  return 'liveLesson.roomError'
}

/**
 * Otağı əldə edir: əvvəlcə server tərəfli atomik RPC, yoxdursa köhnə
 * client-side flow (select → insert → yenidən oxu).
 */
async function ensureRoom(
  requestId: number,
  userId: string
): Promise<{ roomName: string | null; errKey: string | null }> {
  // 1) Server tərəfli atomik create-or-get (migration 16)
  const { data: rpcRoom, error: rpcErr } = await supabase.rpc(
    'ensure_lesson_room',
    { p_request_id: requestId }
  )

  if (!rpcErr && typeof rpcRoom === 'string' && rpcRoom.length > 0) {
    return { roomName: rpcRoom, errKey: null }
  }

  if (rpcErr) {
    const msg = rpcErr.message.toLowerCase()
    const code = (rpcErr.code ?? '').toUpperCase()

    // RPC mövcud deyil (bazada 16 yoxdur) → köhnə flow ilə davam et
    const rpcMissing =
      code === '42883' ||
      code === 'PGRST202' ||
      (msg.includes('function') && msg.includes('does not exist')) ||
      (msg.includes('could not find the') && msg.includes('schema cache'))

    if (!rpcMissing) {
      // RPC işlədi amma rədd etdi — funksiyanın lokal mesajları i18n-ə map olunur
      if (msg.includes('qəbul edilməyib') || msg.includes('artıq tamamlanıb')) {
        return { roomName: null, errKey: 'liveLesson.notAcceptedTitle' }
      }
      return { roomName: null, errKey: 'liveLesson.roomError' }
    }
  }

  // 2) Fallback: köhnə client flow (bazada 16 yoxdursa)
  const { data: existingRoom, error: roomErr } = await supabase
    .from('lesson_rooms')
    .select('id, lesson_request_id, room_name, created_by, created_at')
    .eq('lesson_request_id', requestId)
    .maybeSingle()

  if (roomErr) {
    return { roomName: null, errKey: classifyRequestError(roomErr) }
  }

  if (existingRoom) {
    return { roomName: (existingRoom as LessonRoomRow).room_name, errKey: null }
  }

  // Yeni otaq — room_name təsadüfi UUID ilə
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)

  const newRoomName = `of-course-${requestId}-${uuid}`

  const { data: inserted, error: insertErr } = await supabase
    .from('lesson_rooms')
    .insert({
      lesson_request_id: requestId,
      room_name: newRoomName,
      created_by: userId,
    })
    .select('room_name')
    .single()

  if (!insertErr && inserted) {
    return { roomName: (inserted as { room_name: string }).room_name, errKey: null }
  }

  // Insert uğursuz — bəlkə başqa iştirakçı eyni anda yaratdı, yenidən oxu
  const { data: retryRoom } = await supabase
    .from('lesson_rooms')
    .select('room_name')
    .eq('lesson_request_id', requestId)
    .maybeSingle()

  if (retryRoom) {
    return { roomName: (retryRoom as { room_name: string }).room_name, errKey: null }
  }

  return { roomName: null, errKey: 'liveLesson.roomError' }
}

export function useLessonRoom(requestId: number | null): UseLessonRoomResult {
  const { user, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [roomName, setRoomName] = useState<string | null>(null)
  const [lessonRequest, setLessonRequest] = useState<LessonRequestRow | null>(null)
  const [isParticipant, setIsParticipant] = useState(false)
  const [timing, setTiming] = useState<LessonTiming | null>(null)

  const refreshTiming = useCallback(async () => {
    if (!requestId) return
    const { data, error: timingErr } = await supabase.rpc('get_lesson_timing', {
      p_request_id: requestId,
    })
    if (!timingErr && data) {
      // PostgREST set-returning RPC massiv qaytarır — tək sətri çıxarırıq
      // (əks halda timing.remaining_seconds undefined → NaN taymer)
      const row = Array.isArray(data) ? data[0] : (data as LessonTiming)
      if (row) {
        setTiming(row as LessonTiming)
      }
    }
  }, [requestId])

  useEffect(() => {
    if (authLoading) return

    let ignore = false

    async function loadRoom() {
      if (!user || !requestId) {
        setLoading(false)
        return
      }

      const userId = user.id

      try {
        // 1) lesson_request-i yoxla — RLS yalnız iştirakçılara icazə verir
        //    maybeSingle: sətir görünmürsə (RLS) data = null, xəta yox
        const { data: reqData, error: reqError } = await supabase
          .from('lesson_requests')
          .select('id, requester_id, teacher_id, skill_id, duration_hours, status, scheduled_at, lesson_started_at, lesson_ended_at')
          .eq('id', requestId)
          .maybeSingle()

        if (ignore) return

        if (reqError) {
          setErrorKey(classifyRequestError(reqError))
          setLoading(false)
          return
        }

        if (!reqData) {
          // Sətir ya yoxdur, ya da RLS iştirakçı olmayanlara gizlədir
          setErrorKey('liveLesson.accessDeniedMsg')
          setLoading(false)
          return
        }

        setLessonRequest(reqData as LessonRequestRow)

        const participant =
          reqData.requester_id === userId || reqData.teacher_id === userId
        setIsParticipant(participant)

        if (!participant) {
          setErrorKey('liveLesson.accessDeniedMsg')
          setLoading(false)
          return
        }

        // 2) Status yoxlaması — qəbul edilməyibsə otaq açılmır.
        //    LessonRoom notAccepted kartını göstərir.
        if (reqData.status !== 'accepted') {
          setLoading(false)
          return
        }

        // 3) Server tərəfli atomik otaq əldə etmə (migration 16 RPC + fallback)
        const { roomName: name, errKey } = await ensureRoom(requestId, userId)
        if (ignore) return

        if (errKey) {
          setErrorKey(errKey)
          setLoading(false)
          return
        }

        setRoomName(name)

        // Dərs vaxt məlumatlarını əldə et (countdown timer üçün)
        await refreshTiming()

        if (ignore) return
        setLoading(false)
      } catch (err: unknown) {
        if (ignore) return
        console.error('useLessonRoom:', err)
        setErrorKey('liveLesson.roomError')
        setLoading(false)
      }
    }

    void loadRoom()

    return () => {
      ignore = true
    }
  }, [user, authLoading, requestId, refreshTiming])

  return {
    loading: authLoading || loading,
    errorKey,
    roomName,
    lessonRequest,
    isParticipant,
    timing,
    refreshTiming,
  }
}
