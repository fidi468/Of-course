/**
 * notifications lib — bildiriş tipləri, Supabase API helper-ləri və
 * brauzer bildirişləri (Notification API) üçün köməkçi funksiyalar.
 *
 * Təhlükəsizlik:
 * - Bildirişlər yalnız server tərəfdə yaradılır (trigger / RPC / cron)
 * - Client yalnız SELECT və UPDATE(is_read) icazəsinə malikdir
 * - RLS: istifadəçi yalnız ÖZ bildirişlərini görür
 */

import { supabase } from './supabaseClient'

export type NotificationType =
  | 'lesson_request'
  | 'lesson_accepted'
  | 'lesson_rejected'
  | 'lesson_cancelled'
  | 'lesson_started'
  | 'participant_joined'
  | 'lesson_reminder_24h'
  | 'lesson_reminder_1h'
  | 'lesson_reminder_10min'
  | 'skill_proposal_new'
  | 'skill_proposal_approved'
  | 'skill_proposal_rejected'

export type AppNotification = {
  id: number
  user_id: string
  lesson_request_id: number | null
  actor_id: string | null
  type: NotificationType
  is_read: boolean
  created_at: string
  actor?: {
    full_name: string | null
  } | null
}

export const NOTIFICATIONS_LIMIT = 30

/**
 * Bildiriş siyahısını əldə edir (ən yenilər əvvəl).
 * actor join-u explicit FK adı ilə — cədvəldə profiles-ə iki FK var
 * (user_id və actor_id), ona görə adlandırmadan istifadə mütləqdir.
 */
export async function fetchNotifications(userId: string) {
  return supabase
    .from('notifications')
    .select(
      `id,
       user_id,
       lesson_request_id,
       actor_id,
       type,
       is_read,
       created_at,
       actor:profiles!notifications_actor_id_fkey ( full_name )`
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(NOTIFICATIONS_LIMIT)
}

/** Tək bildirişi oxunmuş kimi işarələ (RLS yalnız öz sətirlərə icazə verir) */
export async function markNotificationRead(id: number) {
  return supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
}

/** Hamısını oxunmuş kimi işarələ */
export async function markAllNotificationsRead(userId: string) {
  return supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
}

/**
 * Bildiriş tipinə görə klik istiqaməti.
 * Sorğu hadisələri → /requests, dərs hadisələri → dərs otağı.
 */
export function notificationLink(
  type: NotificationType,
  lessonRequestId: number | null
): string | null {
  // Bacarıq təklifi bildirişləri dərsə bağlı deyil — birbaşa səhifəyə keçid
  if (type === 'skill_proposal_new') return '/admin'
  if (type === 'skill_proposal_approved' || type === 'skill_proposal_rejected')
    return '/skills'

  if (lessonRequestId === null) return null

  switch (type) {
    case 'lesson_request':
    case 'lesson_accepted':
    case 'lesson_rejected':
    case 'lesson_cancelled':
      return '/requests'

    case 'lesson_started':
    case 'participant_joined':
    case 'lesson_reminder_24h':
    case 'lesson_reminder_1h':
    case 'lesson_reminder_10min':
      return `/lessons/${lessonRequestId}/room`

    default:
      return null
  }
}

/** Bildiriş tipinin i18n açarı (actor adı ilə interpolasiya üçün) */
export function notificationTextKey(type: NotificationType): string {
  return `notifications.types.${type}`
}

// ---------------------------------------------------------------------
// Browser Notifications (Notification API)
// İcazə YALNIZ istifadəçi düyməyə kliklədikdən sonra istənilir.
// ---------------------------------------------------------------------

const BROWSER_PREF_KEY = 'of-course-browser-notifications'

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getBrowserNotificationPref(): boolean {
  try {
    return localStorage.getItem(BROWSER_PREF_KEY) === '1'
  } catch {
    return false
  }
}

export function setBrowserNotificationPref(enabled: boolean): void {
  try {
    localStorage.setItem(BROWSER_PREF_KEY, enabled ? '1' : '0')
  } catch {
    // localStorage əlçatmazdır (private mode) — sessiz davam
  }
}

/**
 * İstifadəçidən brauzer bildiriş icazəsi istəyir.
 * user gesture daxilində çağırılmalıdır (klik event-i).
 */
export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (!browserNotificationsSupported()) return false

  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false

  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

/**
 * OS səviyyəli bildiriş göstərir (icazə + istifadəçi üstünlüyü varsa).
 * Tab gizlidirsə göstərilir; istifadəçi səhifədədirsə in-app bildiriş bəsdir.
 */
export function showBrowserNotification(
  title: string,
  body: string,
  options?: {
    tag?: string
    onClick?: () => void
  }
): void {
  if (!browserNotificationsSupported()) return
  if (Notification.permission !== 'granted') return
  if (!getBrowserNotificationPref()) return
  if (document.visibilityState === 'visible') return

  try {
    const notification = new Notification(title, {
      body,
      icon: '/logo.png',
      tag: options?.tag,
    })

    if (options?.onClick) {
      notification.onclick = () => {
        window.focus()
        options.onClick?.()
        notification.close()
      }
    }
  } catch {
    // Bəzi brauzerlər (mobil Safari) SW olmadan constructor-a icazə vermir — ignore
  }
}
