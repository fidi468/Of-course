
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'

function Login() {
  const { signIn } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setLoading(true)

    try {
      const result = await signIn(email.trim(), password)

      if (result.error) {
        setError(t('login.error'))
        return
      }

      navigate('/skills', { replace: true })
    } catch (err) {
      console.error('Login error:', err)
      setError(t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-80px)] grid grid-cols-1 lg:grid-cols-2">

      {/* LEFT SIDE - LOGIN FORM */}
      <section className="bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">

          <Link to="/" className="text-3xl font-bold text-[#281078]">
            Of Course
          </Link>

          <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">
            {t('login.title')}
          </h1>

          <p className="text-lg text-[#281078] mb-9">
            {t('login.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-7">

            <div>
              <label className="block text-sm mb-2">
                {t('login.email')}
              </label>

              <input
                type="email"
                placeholder={t('common.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-[60px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]"
              />
            </div>

            <div>
              <label className="block text-sm mb-2">
                {t('login.password')}
              </label>

              <input
                type="password"
                placeholder={t('login.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full h-[60px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[60px] rounded-xl bg-[#9225d8] hover:bg-[#781bc0] text-white font-semibold transition disabled:opacity-60"
            >
              {loading ? t('login.loading') : t('login.submit')}
            </button>

          </form>

          {error && (
            <p role="alert" className="text-red-600 mt-4 text-sm">
              {error}
            </p>
          )}

          <p className="text-center text-sm mt-9">
            {t('login.noAccount')}{' '}
            <Link
              to="/register"
              className="text-[#9225d8] font-semibold hover:underline"
            >
              {t('login.register')}
            </Link>
          </p>

          <p className="text-center text-sm mt-3">
            <Link
              to="/forgot-password"
              className="text-[#9225d8] hover:underline"
            >
              {t('login.forgotPassword')}
            </Link>
          </p>

        </div>
      </section>

      {/* RIGHT SIDE - PURPLE PROMOTIONAL PANEL */}
      <section className="hidden lg:flex items-center justify-center px-12 py-16 bg-gradient-to-br from-[#321080] via-[#7615b9] to-[#9d16d8]">
        <div className="max-w-xl text-white">

          <h2 className="text-5xl font-bold leading-tight mb-10">
            {t('login.sideTitle')}
          </h2>

          <p className="text-4xl text-purple-100 leading-snug mb-10">
            {t('login.sideDescription')}
          </p>

          <div className="inline-block bg-[#a5ff9e] text-[#281078] rounded-full px-6 py-4 font-semibold">
            {t('login.gift')}
          </div>

        </div>
      </section>

    </main>
  )
}

export default Login
