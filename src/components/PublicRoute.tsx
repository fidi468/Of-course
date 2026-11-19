
import { Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'

export default function PublicRoute() {
  const { user, loading } = useAuth()
  const { t } = useTranslation()

  if (loading) {
    return <p>{t('common.loading')}</p>
  }

  if (user) {
    return <Navigate to="/skills" replace />
  }

  return <Outlet />
}
