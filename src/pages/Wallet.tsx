
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useCredits } from '../hooks/useCredits'

// Bilinməyən transaction tipləri üçün başlıq
const TX_TYPE_PREFIX = 'txTypes.'

// Səhifələmə — bir dəfədə göstərilən əməliyyat sayı
const PAGE_SIZE = 4

type CreditTransaction = {
  id: number
  amount: number
  type: string
  note: string | null
  created_at: string
}

type WalletTransaction = CreditTransaction & {
  // Əməliyyatdan sonrakı balans ("Qalıq") — cari balansdan sonrakı
  // əməliyyatların məbləği geri hesablanmaqla tapılır
  balanceAfter: number | null
}

type Filter = 'all' | 'earned' | 'spent'

// Bütün əməliyyatların məbləğləri (ümumi qazanc/xərc üçün) —
// useCredits yalnız son 50 əməliyyatı gətirir, statistika tam olmalıdır
function fetchAllAmounts(userId: string) {
  return supabase
    .from('credit_transactions')
    .select('amount')
    .eq('user_id', userId)
}

// Qalıq hesablama: tarixçə yeni→köhnə sıralıdır. Hər əməliyyatdan
// sonrakı balans = cari balans − ondan SONRA baş verən əməliyyatların cəmi
// (təmiz funksiya — komponent xaricində, render zamanı çağırılır)
function withRunningBalance(
  history: CreditTransaction[],
  currentBalance: number | null
): WalletTransaction[] {
  const result: WalletTransaction[] = []
  let sumNewer = 0

  for (const item of history) {
    const balanceAfter =
      currentBalance !== null ? currentBalance - sumNewer : null

    result.push({ ...item, balanceAfter })
    sumNewer += item.amount
  }

  return result
}

function Wallet() {
  const { user } = useAuth()
  const { balance, history, loading, error, reload } = useCredits()
  const { t, i18n } = useTranslation()

  const [filter, setFilter] = useState<Filter>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [totals, setTotals] = useState<{ earned: number; spent: number } | null>(null)

  const dateLocale = { az: 'az-AZ', en: 'en-GB', ru: 'ru-RU', tr: 'tr-TR' }[
    i18n.resolvedLanguage ?? 'az'
  ] ?? 'az-AZ'

  function typeLabel(type: string) {
    const key = `${TX_TYPE_PREFIX}${type}`
    const translated = t(key)

    // tərcümə tapılmadıqda i18next açarın özünü qaytarır — o halda
    // DB-dəki orijinal tipi göstər
    return translated.startsWith(TX_TYPE_PREFIX) ? type : translated
  }

  // "20 noy 2026 · 02:06" formatında tarix
  function formatDateTime(iso: string) {
    const date = new Date(iso)

    const day = date.toLocaleDateString(dateLocale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    const time = date.toLocaleTimeString(dateLocale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    return `${day} · ${time}`
  }

  // Ümumi qazanc/xərc — bütün əməliyyatlar üzrə
  useEffect(() => {
    if (!user) return

    let ignore = false
    const userId = user.id

    async function loadTotals() {
      const { data, error: txError } = await fetchAllAmounts(userId)

      if (ignore || txError) return

      let earned = 0
      let spent = 0

      for (const row of data ?? []) {
        if (row.amount > 0) {
          earned += row.amount
        } else if (row.amount < 0) {
          spent += Math.abs(row.amount)
        }
      }

      setTotals({ earned, spent })
    }

    void loadTotals()

    return () => {
      ignore = true
    }
  }, [user])

  // Qalıq sütunu — təmiz helper funksiyası ilə
  const transactions = useMemo<WalletTransaction[]>(
    () => withRunningBalance(history, balance),
    [history, balance]
  )

  const filteredTransactions = useMemo(() => {
    if (filter === 'earned') {
      return transactions.filter(item => item.amount > 0)
    }

    if (filter === 'spent') {
      return transactions.filter(item => item.amount < 0)
    }

    return transactions
  }, [filter, transactions])

  const visibleTransactions = filteredTransactions.slice(0, visibleCount)

  const earnedTotal = totals?.earned ?? 0
  const spentTotal = totals?.spent ?? 0

  function changeFilter(next: Filter) {
    setFilter(next)
    setVisibleCount(PAGE_SIZE)
  }

  if (loading) return <main><p>{t('wallet.loading')}</p></main>

  if (error) {
    return (
      <main className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#321078] sm:text-4xl">
          {t('wallet.title')}
        </h1>
        <div
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
          role="alert"
        >
          {error ?? t('wallet.error')}
        </div>
        <button
          onClick={() => void reload()}
          className="mt-4 rounded-xl bg-[#8725d5] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6f18b5]"
        >
          {t('wallet.retry')}
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl">
      {/* Səhifə başlığı */}
      <div className="mb-7">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#321078] sm:text-4xl">
          {t('wallet.title')}
        </h1>
        <p className="mt-2 text-sm text-gray-500 sm:text-base">
          {t('wallet.subtitle')}
        </p>
      </div>

      {/* Əsas düzülüş */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.65fr_1fr]">

        {/* Əməliyyatlar */}
        <section>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-[#321078]">
              {t('wallet.historyTitle')}
            </h2>

            <div
              className="flex rounded-full bg-[#f7eafa] p-1"
              role="group"
              aria-label={t('wallet.historyTitle')}
            >
              {([
                { value: 'all', label: t('wallet.filterAll') },
                { value: 'earned', label: t('wallet.filterEarned') },
                { value: 'spent', label: t('wallet.filterSpent') },
              ] as { value: Filter; label: string }[]).map(item => (
                <button
                  key={item.value}
                  onClick={() => changeFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm ${
                    filter === item.value
                      ? 'bg-[#8725d5] text-white shadow-sm'
                      : 'text-[#76658c] hover:text-[#8725d5]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Əməliyyat siyahısı */}
          <div className="space-y-3">
            {visibleTransactions.length > 0 ? (
              visibleTransactions.map(transaction => {
                const isEarned = transaction.amount > 0

                // DB-dəki note tip etiketi ilə eynidirsə təkrar göstərmə
                const note =
                  transaction.note && transaction.note !== typeLabel(transaction.type)
                    ? transaction.note
                    : null

                return (
                  <article
                    key={transaction.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[#ead2f2] bg-white p-4 transition hover:border-[#b96ae0] hover:shadow-md sm:p-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl font-bold ${
                          isEarned
                            ? 'bg-[#a7f3b4] text-[#18743b]'
                            : 'bg-[#fce5ed] text-[#c33d68]'
                        }`}
                        aria-hidden="true"
                      >
                        {isEarned ? '+' : '−'}
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate font-bold text-[#321078]">
                          {typeLabel(transaction.type)}
                        </h3>
                        {note && (
                          <p className="truncate text-xs text-gray-500 sm:text-sm">
                            {note}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-400">
                          {formatDateTime(transaction.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p
                        className={`font-bold ${
                          isEarned ? 'text-green-700' : 'text-rose-600'
                        }`}
                      >
                        {isEarned ? '+' : ''}
                        {transaction.amount} {t('common.credits')}
                      </p>
                      {transaction.balanceAfter !== null && (
                        <p className="mt-1 text-xs text-gray-400">
                          {t('wallet.balanceAfter', { value: transaction.balanceAfter })}
                        </p>
                      )}
                    </div>
                  </article>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-purple-200 py-12 text-center">
                <p className="font-semibold text-[#321078]">
                  {t('wallet.emptyTitle')}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {t('wallet.emptyText')}
                </p>
              </div>
            )}
          </div>

          {visibleCount < filteredTransactions.length && (
            <button
              onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
              className="mt-4 w-full rounded-xl border-2 border-[#8725d5] py-3 font-semibold text-[#8725d5] transition hover:bg-[#8725d5] hover:text-white"
            >
              {t('wallet.showMore')}
            </button>
          )}
        </section>

        {/* Balans paneli */}
        <aside className="space-y-4">

          {/* Cari balans */}
          <div className="rounded-2xl bg-gradient-to-br from-[#321078] via-[#6214b6] to-[#9225d5] p-6 text-white shadow-lg sm:p-7">
            <p className="text-sm text-purple-100">
              {t('wallet.balanceLabel')}
            </p>

            <h2 className="mt-2 text-5xl font-extrabold tracking-tight">
              {balance ?? 0} {t('common.credits')}
            </h2>

            <p className="mt-2 text-sm text-purple-100">
              {t('wallet.balanceHint')}
            </p>

            <Link
              to="/skills"
              className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#7620c3] transition hover:bg-purple-100"
            >
              {t('wallet.viewSkills')}
            </Link>
          </div>

          {/* Qazanc və xərc */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#dcfce1] p-4 text-center">
              <p className="text-xs font-medium text-green-800">
                {t('wallet.earnedTotal')}
              </p>
              <p className="mt-1 text-xl font-extrabold text-green-800">
                +{earnedTotal} {t('common.credits')}
              </p>
            </div>

            <div className="rounded-2xl bg-[#fce4ed] p-4 text-center">
              <p className="text-xs font-medium text-rose-700">
                {t('wallet.spentTotal')}
              </p>
              <p className="mt-1 text-xl font-extrabold text-rose-700">
                -{spentTotal} {t('common.credits')}
              </p>
            </div>
          </div>

          {/* Kredit necə işləyir */}
          <div className="rounded-2xl border border-[#ead2f2] bg-[#fbf2fd] p-5">
            <h3 className="text-center font-bold text-[#321078]">
              {t('wallet.howTitle')}
            </h3>

            <ul className="mt-3 space-y-3 text-sm text-[#6e5685]">
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                {t('wallet.ruleTeach')}
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                {t('wallet.ruleLearn')}
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                {t('wallet.ruleNoNegative')}
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                {t('wallet.ruleTransfer')}
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default Wallet
