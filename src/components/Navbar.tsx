
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCredits } from '../hooks/useCredits'
import { useTranslation } from 'react-i18next'
import NotificationBell from './NotificationBell'

export default function Navbar() {
  const { user, loading } = useAuth()
  const { balance, loading: creditsLoading } = useCredits()
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation()

  function handleLanguageChange(
    event: React.ChangeEvent<HTMLSelectElement>
  ) {
    void i18n.changeLanguage(event.target.value)
  }

  const userInitial = user?.email
    ? user.email.charAt(0).toUpperCase()
    : 'U'

  const navLinks = [
    { path: '/skills', label: t('nav.skills') },
    { path: '/requests', label: t('nav.requests') },
    { path: '/sessions', label: t('nav.sessions') },
    { path: '/credits', label: t('nav.wallet') },
  ]

  return (
    <nav className="w-full bg-white border-b border-purple-100 shadow-sm">
      <div className="max-w-7xl mx-auto min-h-[58px] px-3 sm:px-6 flex items-center justify-between gap-2">

        {/* Logo */}
        <Link
          to={user ? '/skills' : '/'}
          className="flex items-center gap-1.5 shrink-0"
        >
          <img
            src="/logo.png"
            alt="Of Course"
            className="w-7 h-7 object-contain"
          />

          <span className="text-[#24105c] font-bold text-sm tracking-tight">
            Of Course
          </span>
        </Link>

        {/* Navigation */}
        {user && !loading && (
          <div className="flex items-center gap-0.5 sm:gap-1">
            {navLinks.map((item) => {
              const active =
                location.pathname === item.path ||
                (item.path === '/skills' &&
                  location.pathname === '/')

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`
                    px-1.5 sm:px-3 py-1.5
                    rounded-md
                    text-[9px] sm:text-xs
                    whitespace-nowrap
                    transition-all duration-200
                    ${
                      active
                        ? 'bg-[#efd2fc] text-[#9333ea] font-semibold'
                        : 'text-[#3b3155] hover:bg-purple-50 hover:text-[#9333ea]'
                    }
                  `}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        )}

        {/* Right side */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

          {loading ? (
            <span className="text-xs text-gray-400">
              {t('common.loading')}
            </span>
          ) : user ? (
            <>
              {/* Notifications bell */}
              <NotificationBell />

              {/* Credit balance */}
              <Link
                to="/credits"
                className="bg-[#b8f5c2] text-[#166534] rounded-full px-2 sm:px-3 py-1.5 hover:brightness-95 transition"
              >
                <span className="text-[8px] sm:text-[10px] font-bold whitespace-nowrap">
                  {creditsLoading
                    ? '...'
                    : `${t('common.balance')}: ${balance ?? 0} ${t('common.hours')}`}
                </span>
              </Link>

              {/* Share a skill (goes to profile add-skill modal) */}
              <Link
                to="/profile?add=1"
                className="bg-[#8b1fe0] hover:bg-[#7415c2] text-white rounded-full px-2 sm:px-3 py-1.5 text-[8px] sm:text-[10px] font-semibold whitespace-nowrap transition"
              >
                {t('nav.shareSkill')}
              </Link>

              {/* Profile / Logout */}
              <button
                onClick={() => navigate('/profile')}
                title={t('nav.profile')}
                aria-label={t('nav.profile')}
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#8b1fe0] text-white text-[10px] sm:text-xs font-bold flex items-center justify-center hover:bg-[#7415c2] transition"
              >
                {userInitial}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <Link
                to="/login"
                className="text-[#3b3155] hover:text-purple-600"
              >
                {t('nav.login')}
              </Link>

              <Link
                to="/register"
                className="bg-[#8b1fe0] text-white px-2.5 py-1.5 rounded-full hover:bg-[#7415c2] transition"
              >
                {t('nav.register')}
              </Link>
            </div>
          )}

          {/* Language */}
          <select
            value={i18n.resolvedLanguage?.split('-')[0] || 'az'}
            onChange={handleLanguageChange}
            aria-label={t('nav.language')}
            className="bg-white border border-purple-100 rounded-md px-1 py-1 text-[9px] sm:text-[10px] text-[#3b3155] outline-none focus:border-purple-400 cursor-pointer"
          >
            <option value="az">AZ</option>
            <option value="en">EN</option>
            <option value="ru">RU</option>
            <option value="tr">TR</option>
          </select>

        </div>
      </div>
    </nav>
  )
}
