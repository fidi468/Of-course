
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'

function Register() {
  const { signUp } = useAuth()
  const { t } = useTranslation()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setMessage('')

    if (password !== confirmPassword) {
      setError(t('register.passwordMismatch'))
      return
    }

    setLoading(true)

    try {
      const result = await signUp(
        email.trim(),
        password,
        fullName.trim()
      )

      if (result.error) {
        console.error('Registration error:', result.error)

        if (
          result.error.message.toLowerCase().includes('already registered') ||
          result.error.message.toLowerCase().includes('already exists')
        ) {
          setError('Bu e-poçt ünvanı ilə artıq qeydiyyatdan keçilib. Zəhmət olmasa, giriş edin.')
        } else {
          setError(result.error.message)
        }
      } else if (
        result.data.user &&
        result.data.user.identities?.length === 0
      ) {
        setError('Bu e-poçt ünvanı ilə artıq qeydiyyatdan keçilib. Zəhmət olmasa, giriş edin.')
      } else {
        setMessage(t('register.success'))
      }
    } catch (err) {
      console.error('Unexpected registration error:', err)
      setError('Qeydiyyat zamanı xəta baş verdi. Yenidən cəhd edin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-80px)] grid grid-cols-1 lg:grid-cols-2">
      <section className="bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">

          <Link to="/" className="text-3xl font-bold text-[#281078]">
            Of Course
          </Link>

          <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">
            {t('register.title')}
          </h1>

          <p className="text-lg text-[#281078] mb-9">
            {t('register.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-7">

            <div>
              <label className="block text-sm mb-2">
                {t('register.name')}
              </label>

              <input
                type="text"
                placeholder={t('register.namePlaceholder')}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full h-[60px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]"
              />
            </div>

            <div>
              <label className="block text-sm mb-2">
                {t('register.email')}
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
                {t('register.password')}
              </label>

              <input
                type="password"
                placeholder={t('register.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                className="w-full h-[60px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]"
              />
            </div>

            <div>
              <label className="block text-sm mb-2">
                {t('register.confirmPassword')}
              </label>

              <input
                type="password"
                placeholder={t('register.confirmPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full h-[60px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[60px] rounded-xl bg-[#9225d8] hover:bg-[#781bc0] text-white font-semibold transition disabled:opacity-60"
            >
              {loading ? t('register.loading') : t('register.submit')}
            </button>

          </form>

          {error && (
            <p role="alert" className="text-red-600 mt-4 text-sm">
              {error}
            </p>
          )}

          {message && (
            <p role="status" className="text-green-600 mt-4 text-sm">
              {message}
            </p>
          )}

          <p className="text-center text-sm mt-9">
            {t('register.hasAccount')}{' '}
            <Link
              to="/login"
              className="text-[#9225d8] font-semibold hover:underline"
            >
              {t('register.login')}
            </Link>
          </p>

        </div>
      </section>

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

export default Register
