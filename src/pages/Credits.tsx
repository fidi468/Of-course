import { useCredits } from '../hooks/useCredits'
import { useTranslation } from 'react-i18next'

function Credits() {
  const { balance, history, loading, error, reload } = useCredits()
  const { t, i18n } = useTranslation()

  if (loading) return <main><p>{t('creditsPage.loading')}</p></main>

  if (error) {
    return <main><h1>{t('creditsPage.title')}</h1><p role="alert">{t('creditsPage.error')}</p><button onClick={reload}>{t('creditsPage.retry')}</button></main>
  }

  return (
    <main>
      <h1>{t('creditsPage.title')}</h1>
      <section>
        <h2>{t('creditsPage.balance')}</h2>
        <p>{balance ?? 0} {t('common.credits')}</p>
      </section>
      <section>
        <h2>{t('creditsPage.transactions')}</h2>
        {history.length === 0 ? <p>{t('common.noTransactions')}</p> : (
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <strong>{item.amount} {t('common.credits')}</strong>{' - '}{item.type}
                {item.note && ` (${item.note})`}
                <br />
                <small>{new Date(item.created_at).toLocaleString(i18n.resolvedLanguage || 'az')}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
export default Credits
