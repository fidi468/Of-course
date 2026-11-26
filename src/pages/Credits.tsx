
import { useCredits } from '../hooks/useCredits'
import { useTranslation } from 'react-i18next'

// Bilinməyən transaction tipləri üçün başlıq
const TX_TYPE_PREFIX = 'txTypes.'

function Credits() {
  const { balance, history, loading, error, reload } = useCredits()
  const { t, i18n } = useTranslation()

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

  if (loading) return <main><p>{t('creditsPage.loading')}</p></main>

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-[#281078]">{t('creditsPage.title')}</h1>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
          {error ?? t('creditsPage.error')}
        </div>
        <button
          onClick={() => void reload()}
          className="mt-4 rounded-xl bg-[#8520d0] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6f18b5]"
        >
          {t('creditsPage.retry')}
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-[#291078]">
      <h1 className="text-2xl font-bold">{t('creditsPage.title')}</h1>

      <section className="mt-6 rounded-2xl border border-[#ead0f6] bg-[#faf4fd] p-5">
        <h2 className="text-sm text-[#8065a8]">{t('creditsPage.balance')}</h2>
        <p className="mt-1 text-3xl font-bold text-[#861bd2]">
          {balance ?? 0} {t('common.credits')}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">{t('creditsPage.transactions')}</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[#8065a8]">{t('common.noTransactions')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-[#ead0f6] bg-white px-4 py-3 text-sm"
              >
                <strong className={item.amount >= 0 ? 'text-green-700' : 'text-red-600'}>
                  {item.amount > 0 ? '+' : ''}{item.amount} {t('common.credits')}
                </strong>{' '}
                — {typeLabel(item.type)}
                {item.note && ` (${item.note})`}
                <br />
                <small className="text-[#8065a8]">
                  {new Date(item.created_at).toLocaleString(dateLocale)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
export default Credits
