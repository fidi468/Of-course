/**
 * useNotifications — in-app bildirişlər üçün mərkəzi hook.
 *
 * Xüsusiyyətlər:
 * - Supabase Realtime (postgres_changes) ilə canlı INSERT hadisələri
 * - RLS server tərəfində tətbiq olunur + client filter user_id=eq.<uid>
 *   (başqa istifadəçinin bildirişi heç vaxt çatmır)
 * - Təkrarlanma qorunması: seen-id set — hər bildiriş id-based yoxlanır
 * - Browser notification: yalnız tab gizlidirsə + icazə varsa + üstünlük varsa
 * - Migration tətbiq edilməyibsə (cədvəl yoxdur) — SƏSSİCƏLİKLƏ deqradasiya:
 *   boş siyahı, xəta istifadəçiyə çatmır, app işləməyə davam edir
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './useAuth'
import { useTranslation } from 'react-i18next'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationLink,
  notificationTextKey,
  NOTIFICATIONS_LIMIT,
  showBrowserNotification,
} from '../lib/notifications'
import type { AppNotification } from '../lib/notifications'

export function useNotifications() {
  const { user } = useAuth()
  const { t } = useTranslation()

  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  // Təkrarlanma qorunması — gördüyümüz bildiriş id-ləri
  const seenIdsRef = useRef<Set<number>>(new Set())
  // İlk yükləmədə browser notification göstərilmir (köhnələr "yeni" deyil)
  const initialLoadDoneRef = useRef(false)

  const isSchemaError = (code?: string, message?: string): boolean => {
    const c = (code ?? '').toUpperCase()
    const m = (message ?? '').toLowerCase()
    return (
      c === 'PGRST204' ||
      c === '42P01' ||
      (m.includes('does not exist') && m.includes('column')) ||
      (m.includes('could not find the') && m.includes('schema cache'))
    )
  }

  const applyResult = useCallback(
    (rows: AppNotification[]) => {
      setNotifications(rows)
      setUnreadCount(rows.filter(n => !n.is_read).length)
      seenIdsRef.current = new Set(rows.map(n => n.id))
      initialLoadDoneRef.current = true
      setLoading(false)
    },
    []
  )

  // İlk yükləmə + giriş dəyişdikdə yenidən.
  // Pattern Requests.tsx ilə eynidir: async funksiya effect daxilində,
  // birinci ifadə real await — setState yalnız await-dən SONRA çağırılır.
  useEffect(() => {
    if (!user) return

    let ignore = false
    const userId = user.id

    async function fetchInitial() {
      const { data, error } = await fetchNotifications(userId)

      if (ignore) return

      if (error) {
        // Cədvəl hələ yoxdursa (migration tətbiq edilməyib) — səssiz deqradasiya
        if (!isSchemaError(error.code, error.message)) {
          console.error('useNotifications load error:', error.message)
        }
        applyResult([])
        return
      }

      applyResult((data ?? []) as unknown as AppNotification[])
    }

    void fetchInitial()

    return () => {
      ignore = true
      seenIdsRef.current = new Set()
    }
  }, [user, applyResult])

  // Realtime abunəlik — yalnız ÖZ bildirişlərinin INSERT hadisələri
  useEffect(() => {
    if (!user) return

    const userId = user.id
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<AppNotification>) => {
          // supabase-js payload.new-i {} | Row tipləndirir — real INSERT sətri
          // AppNotification formasındadır, id yoxlaması ilə daraldırıq
          const row = payload.new as AppNotification | null
          if (!row || typeof row.id !== 'number') return

          // Təkrarlanma qorunması — eyni id ikinci dəfə işlənmir
          if (seenIdsRef.current.has(row.id)) return
          seenIdsRef.current.add(row.id)

          setNotifications(prev => [row, ...prev].slice(0, NOTIFICATIONS_LIMIT))
          setUnreadCount(prev => prev + 1)

          if (!initialLoadDoneRef.current) return

          // Realtime payload-da actor adı yoxdur (yalnız xam sətir gəlir) —
          // profiles-dən çəkib state-i və browser bildirişini zənginləşdiririk
          const withActorName = async () => {
            let name = ''
            if (row.actor_id) {
              const { data: actorRow } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', row.actor_id)
                .maybeSingle()

              name = (actorRow as { full_name: string | null } | null)
                ?.full_name
                ?.trim() ?? ''

              if (name) {
                setNotifications(prev =>
                  prev.map(n =>
                    n.id === row.id
                      ? { ...n, actor: { full_name: name } }
                      : n
                  )
                )
              }
            }

            const text = t(notificationTextKey(row.type), {
              name: name || t('notifications.unknownUser'),
            })
            showBrowserNotification(t('notifications.browserTitle'), text, {
              tag: `of-course-notification-${row.id}`,
              onClick: () => {
                const link = notificationLink(row.type, row.lesson_request_id)
                if (link) window.location.assign(link)
              },
            })
          }

          void withActorName()
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Cədvəl yoxdursa və ya şəbəkə xətası varsa — səssiz davam;
          // polling yoxdur, növbəti açılışda yenidən yoxlanacaq
          console.warn('notifications realtime:', status)
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user, t])

  // Dropdown açılanda təzə məlumat çək (event handler — sinxron setState serbestdir)
  const refresh = useCallback(async () => {
    if (!user) return

    const userId = user.id
    const { data, error } = await fetchNotifications(userId)

    if (error) {
      if (!isSchemaError(error.code, error.message)) {
        console.error('useNotifications refresh error:', error.message)
      }
      return
    }

    applyResult((data ?? []) as unknown as AppNotification[])
  }, [user, applyResult])

  // Tək bildirişi oxunmuş et (optimistic)
  const markRead = useCallback(async (id: number) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
    )
    setUnreadCount(prev => Math.max(0, prev - 1))

    const { error } = await markNotificationRead(id)
    if (error) {
      console.error('markRead error:', error.message)
      void refresh() // server vəziyyətini bərpa et
    }
  }, [refresh])

  // Hamısını oxunmuş et (optimistic)
  const markAllRead = useCallback(async () => {
    if (!user) return
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)

    const { error } = await markAllNotificationsRead(user.id)
    if (error) {
      console.error('markAllRead error:', error.message)
      void refresh()
    }
  }, [user, refresh])

  return {
    notifications,
    unreadCount,
    loading,
    refresh,
    markRead,
    markAllRead,
  }
}
