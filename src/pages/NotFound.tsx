
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function NotFound() {
  const { t } = useTranslation()

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <div className="text-center">
        <p className="text-6xl font-bold text-[#9225d8]">404</p>

        <h1 className="mt-4 text-2xl font-bold text-[#281078]">
          {t('notFound.title')}
        </h1>

        <p className="mt-2 text-sm text-[#604c85]">
          {t('notFound.description')}
        </p>

        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-[#9225d8] hover:bg-[#781bc0] text-white px-6 py-2.5 text-sm font-semibold transition"
        >
          {t('notFound.back')}
        </Link>
      </div>
    </main>
  )
}

export default NotFound
