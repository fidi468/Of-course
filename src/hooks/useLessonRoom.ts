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

import { useState, useEffect } from 'react'
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
}

type UseLessonRoomResult = {
  loading: boolean
  error: string | null
  roomName: string | null
  lessonRequest: LessonRequestRow | null
  isParticipant: boolean
}

export function useLessonRoom(requestId: number | null): UseLessonRoomResult {
  const { user, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roomName, setRoomName] = useState<string | null>(null)
  const [lessonRequest, setLessonRequest] = useState<LessonRequestRow | null>(null)
  const [isParticipant, setIsParticipant] = useState(false)

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
          .select('id, requester_id, teacher_id, skill_id, duration_hours, status, scheduled_at')
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
  }, [user, authLoading, requestId])

  return {
    loading: authLoading || loading,
    error,
    roomName,
    lessonRequest,
    isParticipant,
  }
}
