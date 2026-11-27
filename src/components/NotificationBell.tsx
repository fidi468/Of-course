/**
 * NotificationBell — Navbar-da bildiriş zəngi.
 *
 * Xüsusiyyətlər:
 * - Oxunmamış sayı badge-də (9+ limit)
 * - Dropdown: son 30 bildiriş, tiplərə görə ikonlar, relative vaxt
 * - Klik → bildiriş oxunmuş + uyğun səhifəyə keçid (dərs otağı / sorğular)
 * - "Hamısını oxunmuş et"
 * - Brauzer bildirişlərinin aktivləşdirilməsi — YALNIZ istifadəçi klikləyəndə
 *   icazə istənilir (Notification.requestPermission user gesture-də)
 * - Klik xaricində / Escape → dropdown bağlanır
 * - Mobil: ekran genişliyinə uyğun dropdown
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotifications } from '../hooks/useNotifications'
import {
  browserNotificationsSupported,
  getBrowserNotificationPref,
  notificationLink,
  notificationTextKey,
  requestBrowserNotificationPermission,
  setBrowserNotificationPref,
} from '../lib/notifications'
import type { AppNotification, NotificationType } from '../lib/notifications'

// Dil kodu → relative vaxt formatı üçün locale
const TIME_LOCALES: Record<string, string> = {
  az: 'az-AZ',
  en: 'en-GB',
  ru: 'ru-RU',
  tr: 'tr-TR',
}

type IconStyle = { path: string; className: string }

// Tip → SVG ikon + rəng (emoji yox, vektor ikonlar)
const ICONS: Record<NotificationType, IconStyle> = {
  lesson_request: {
    path: 'M12 6v6m0 0v6m0-6h6m-6 0H6m14 6a9 9 0 11-18 0 9 9 0 0118 0z',
    className: 'text-[#861bd2] bg-[#f4e1fb]',
  },
  lesson_accepted: {
    path: 'M5 13l4 4L19 7',
    className: 'text-green-700 bg-green-50',
  },
  lesson_rejected: {
    path: 'M6 18L18 6M6 6l12 12',
    className: 'text-red-600 bg-red-50',
  },
  lesson_cancelled: {
    path: 'M6 18L18 6M6 6l12 12',
    className: 'text-gray-500 bg-gray-100',
  },
  lesson_started: {
    path: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    className: 'text-[#7022bd] bg-[#ead8ff]',
  },
  participant_joined: {
    path: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    className: 'text-blue-700 bg-blue-50',
  },
  lesson_reminder_24h: {
    path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    className: 'text-amber-700 bg-amber-50',
  },
  lesson_reminder_1h: {
    path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    className: 'text-amber-700 bg-amber-50',
  },
  lesson_reminder_10min: {
    path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    className: 'text-red-600 bg-red-50',
  },
  skill_proposal_new: {
    // "qələm + plus" təklif ikonu
    path: 'M12 4v16m8-8H4M15.5 4.5l4 4M7.5 16.5L17 7l-4-4-9.5 9.5V16.5h4z',
    className: 'text-[#8b20d5] bg-[#f4e1fb]',
  },
  skill_proposal_approved: {
    path: 'M5 13l4 4L19 7',
    className: 'text-green-700 bg-green-50',
  },
  skill_proposal_rejected: {
    path: 'M6 18L18 6M6 6l12 12',
    className: 'text-red-600 bg-red-50',
  },
}

function NotificationIcon({ type }: { type: NotificationType }) {
  const icon = ICONS[type] ?? ICONS.lesson_started
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${icon.className}`}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={icon.path} />
      </svg>
    </span>
  )
}

/** Relative vaxt: <1 dəq "indi", sonra dəq/saat/gün əvvəl */
function formatRelativeTime(
  iso: string,
  locale: string
): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const diffMs = Date.now() - then
  const diffMinutes = Math.floor(diffMs / 60000)

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (diffMinutes < 1) return rtf.format(0, 'minute')
    if (diffMinutes < 60) return rtf.format(-diffMinutes, 'minute')
    const hours = Math.floor(diffMinutes / 60)
    if (hours < 24) return rtf.format(-hours, 'hour')
    const days = Math.floor(hours / 24)
    return rtf.format(-days, 'day')
  } catch {
    return new Date(iso).toLocaleString(locale)
  }
}

export default function NotificationBell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const {
    notifications,
    unreadCount,
    loading,
    refresh,
    markRead,
    markAllRead,
  } = useNotifications()

  const [open, setOpen] = useState(false)
  const [browserPref, setBrowserPref] = useState(() =>
    getBrowserNotificationPref()
  )
  const rootRef = useRef<HTMLDivElement>(null)

  // Klik xaricində bağla + açılan kimi təzə məlumat çək
  useEffect(() => {
    if (!open) return

    void refresh()

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
    // refresh intentionally excluded: dropdown açılışında bir dəfə çağırılır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleItemClick(item: AppNotification) {
    if (!item.is_read) void markRead(item.id)
    setOpen(false)

    const link = notificationLink(item.type, item.lesson_request_id)
    if (link) navigate(link)
  }

  async function handleBrowserToggle() {
    if (!browserNotificationsSupported()) return

    if (browserPref) {
      // Yandır — icazəni geri ala bilmərik (brauzer parametrlərində), amma
      // göstərməni dayandırırıq
      setBrowserNotificationPref(false)
      setBrowserPref(false)
      return
    }

    const granted = await requestBrowserNotificationPermission()
    if (granted) {
      setBrowserNotificationPref(true)
      setBrowserPref(true)
    } else {
      setBrowserNotificationPref(false)
      setBrowserPref(false)
    }
  }

  const showBrowserToggle =
    browserNotificationsSupported() &&
    Notification.permission !== 'denied'

  const browserGranted = browserNotificationsSupported() &&
    Notification.permission === 'granted' &&
    browserPref

  return (
    <div ref={rootRef} className="relative">
      {/* Zəng düyməsi */}
      <button
        onClick={() => setOpen(prev => !prev)}
        aria-label={t('notifications.title')}
        title={t('notifications.title')}
        className="relative flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full border border-[#ead0f6] bg-white text-[#861bd2] transition hover:bg-[#faf4fd]"
      >
        <svg
          className="h-3.5 w-3.5 sm:h-4 sm:w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e11d48] px-1 text-[8px] font-bold text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          data-testid="notification-dropdown"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-[#ead0f6] bg-white shadow-xl"
        >
          {/* Başlıq */}
          <div className="flex items-center justify-between border-b border-[#f0e2f7] px-4 py-3">
            <p className="text-xs font-bold text-[#291078]">
              {t('notifications.title')}
              {unreadCount > 0 && (
                <span className="ml-2 text-[10px] font-semibold text-[#8065a8]">
                  {t('notifications.unreadCount', { count: unreadCount })}
                </span>
              )}
            </p>

            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                className="text-[10px] font-semibold text-[#861bd2] transition hover:text-[#7015b5]"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          {/* Siyahı */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-xs text-[#8065a8]">
                {t('common.loading')}
              </p>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-xs font-semibold text-[#604c85]">
                  {t('notifications.empty')}
                </p>
                <p className="mt-1 text-[10px] text-[#a18bb8]">
                  {t('notifications.emptyHint')}
                </p>
              </div>
            ) : (
              notifications.map(item => (
                <button
                  key={item.id}
                  onClick={() => void handleItemClick(item)}
                  className={`flex w-full items-start gap-3 border-b border-[#f6effa] px-4 py-3 text-left transition last:border-b-0 hover:bg-[#faf4fd] ${
                    item.is_read ? 'bg-white' : 'bg-[#fcf8fe]'
                  }`}
                >
                  <NotificationIcon type={item.type} />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span
                        className={`block text-xs leading-5 ${
                          item.is_read
                            ? 'font-normal text-[#604c85]'
                            : 'font-semibold text-[#291078]'
                        }`}
                      >
                        {t(notificationTextKey(item.type), {
                          name:
                            item.actor?.full_name?.trim() ||
                            t('notifications.unknownUser'),
                        })}
                      </span>

                      {!item.is_read && (
                        <span
                          aria-hidden
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#861bd2]"
                        />
                      )}
                    </span>

                    <span className="mt-1 block text-[9px] text-[#a18bb8]">
                      {formatRelativeTime(
                        item.created_at,
                        TIME_LOCALES[i18n.resolvedLanguage ?? 'az'] ?? 'az-AZ'
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Brauzer bildirişləri — yalnız istifadəçi razılığı ilə */}
          {showBrowserToggle && (
            <div className="border-t border-[#f0e2f7] bg-[#faf4fd] px-4 py-3">
              <button
                onClick={() => void handleBrowserToggle()}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-[10px] leading-4 text-[#604c85]">
                  {browserGranted
                    ? t('notifications.browserEnabled')
                    : t('notifications.enableBrowser')}
                </span>

                <span
                  aria-hidden
                  className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition ${
                    browserGranted ? 'bg-[#861bd2]' : 'bg-[#e0d3ec]'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white transition ${
                      browserGranted ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>

              {browserNotificationsSupported() &&
                Notification.permission === 'denied' && (
                  <p className="mt-2 text-[9px] text-[#a18bb8]">
                    {t('notifications.browserDenied')}
                  </p>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
