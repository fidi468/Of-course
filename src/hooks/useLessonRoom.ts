/**
 * useLessonRoom — bir lesson_request üçün Jitsi otaq məlumatını əldə edir
 * və ya (yoxdursa) yaradır.
 *
 * Workflow:
 * 1. lesson_request-i yoxlayırıq (RLS yalnız iştirakçılara icazə verir)
 * 2. lesson_rooms cədvəlində bu request üçün artıq otaq var mı yoxlayırıq
 * 3. Yoxdursa, yeni otaq yaradırıq (room_name = of-course-{requestId}-{uuid})
 * 4. room_name qaytarırıq — JitsiMeet komponenti bunu istifadə edir
 *
 * Təhlükəsizlik:
 * - RLS yalnız iştirakçılara select/insert icazə verir
 * - room_name təsadüfi UUID ilə generate olunur (proqnozlaşdırıla bilməz)
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './useAuth'

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
  error: string | null
  roomName: string | null
  lessonRequest: LessonRequestRow | null
  isParticipant: boolean
  timing: LessonTiming | null
  refreshTiming: () => Promise<void>
}

export function useLessonRoom(requestId: number | null): UseLessonRoomResult {
  const { user, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
      setTiming(data as LessonTiming)
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
        const { data: reqData, error: reqError } = await supabase
          .from('lesson_requests')
          .select('id, requester_id, teacher_id, skill_id, duration_hours, status, scheduled_at, lesson_started_at, lesson_ended_at')
          .eq('id', requestId)
          .single()

        if (ignore) return

        if (reqError || !reqData) {
          setError('Bu dərs sorğusuna icazəniz yoxdur')
          setLoading(false)
          return
        }

        setLessonRequest(reqData as LessonRequestRow)

        const participant =
          reqData.requester_id === userId || reqData.teacher_id === userId
        setIsParticipant(participant)

        if (!participant) {
          setError('Bu dərs sorğusuna icazəniz yoxdur')
          setLoading(false)
          return
        }

        // 2) Bu request üçün artıq otaq var mı?
        const { data: existingRoom, error: roomErr } = await supabase
          .from('lesson_rooms')
          .select('id, lesson_request_id, room_name, created_by, created_at')
          .eq('lesson_request_id', requestId)
          .maybeSingle()

        if (ignore) return

        if (roomErr) {
          setError(roomErr.message)
          setLoading(false)
          return
        }

        if (existingRoom) {
          setRoomName((existingRoom as LessonRoomRow).room_name)
          setLoading(false)
          return
        }

        // 3) Yeni otaq yaradırıq — room_name təsadüfi UUID ilə
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

        if (ignore) return

        if (insertErr) {
          // Bəlkə başqa istifadəçi eyni anda yaratdı — yenidən oxuyaq
          const { data: retryRoom } = await supabase
            .from('lesson_rooms')
            .select('room_name')
            .eq('lesson_request_id', requestId)
            .maybeSingle()

          if (ignore) return

          if (retryRoom) {
            setRoomName((retryRoom as { room_name: string }).room_name)
          } else {
            setError(insertErr.message)
          }
          setLoading(false)
          return
        }

        setRoomName((inserted as { room_name: string }).room_name)

        // Dərs vaxt məlumatlarını əldə et (countdown timer üçün)
        await refreshTiming()

        setLoading(false)
      } catch (err: unknown) {
        if (ignore) return
        setError(err instanceof Error ? err.message : 'Otaq məlumatları yüklənmədi')
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
    error,
    roomName,
    lessonRequest,
    isParticipant,
    timing,
    refreshTiming,
  }
}
