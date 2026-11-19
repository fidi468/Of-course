import { useTranslation } from 'react-i18next'

function Lessons() {
  const { t } = useTranslation()
  return (
    <main>
      <h1>{t('lessons.title')}</h1>
      <p>{t('lessons.description')}</p>
    </main>
  )
}
export default Lessons
