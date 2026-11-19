
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'
import { authErrorKey } from '../lib/authErrors'

// Göndərmələr arasındaki müdafiə ilə gözləmə (san)
const RESEND_COOLDOWN = 60

function ForgotPassword() {
  const { resetPassword } = useAuth()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)

  // Geri sayım — düymənin yenidən basılmasının qarşısını alır
  useEffect(() => {
    if (cooldown <= 0) return

    const timer = window.setInterval(() => {
      setCooldown(seconds => (seconds > 0 ? seconds - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [cooldown])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (cooldown > 0) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const result = await resetPassword(email)

      if (result.error) {
        // "Email rate limit exceeded" və s. — hər xəta seçilmiş dilə çevrilir
        const errorKey = authErrorKey(result.error)
        setError(t(errorKey))

        // Limit xətası — dərhal təkrar cəhd yenə uğursuz olacaq, gözləmə başlat
        if (errorKey === 'errors.rateLimit') {
          setCooldown(RESEND_COOLDOWN)
        }
      } else {
        setMessage(t('forgot.success'))
        setCooldown(RESEND_COOLDOWN)
      }
    } catch (err) {
      console.error('Password reset error:', err)
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-80px)] grid grid-cols-1 lg:grid-cols-2">
      <section className="bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="text-3xl font-bold text-[#281078]">Of Course</Link>
          <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">{t('forgot.title')}</h1>
          <p className="text-lg text-[#281078] mb-9">{t('forgot.subtitle')}</p>
          <form onSubmit={handleSubmit} className="space-y-7">
            <div><label className="block text-sm mb-2">{t('common.email')}</label><input type="email" placeholder={t('common.emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]" /></div>
            <button type="submit" disabled={loading || cooldown > 0} className="w-full h-[58px] rounded-xl bg-[#8520d0] text-white font-semibold hover:bg-[#6f18b5] transition disabled:opacity-60">
              {loading
                ? t('forgot.loading')
                : cooldown > 0
                  ? t('errors.cooldown', { seconds: cooldown })
                  : t('forgot.submit')}
            </button>
          </form>
          {error && <p role="alert" className="text-red-600 mt-4 text-sm">{error}</p>}
          {message && (
            <div className="mt-5 text-sm text-green-700">
              <p>{message}</p>
              <Link
                to="/reset-password?mode=code"
                className="inline-block mt-3 text-[#9225d8] font-semibold hover:underline"
              >
                {t('forgot.useCode')}
              </Link>
            </div>
          )}
          <div className="text-right mt-7"><Link to="/login" className="text-sm text-[#9225d8] hover:underline">{t('forgot.back')}</Link></div>
        </div>
      </section>
      <section className="hidden lg:flex items-center justify-center px-12 py-16 bg-gradient-to-br from-[#321080] via-[#7615b9] to-[#9d16d8]">
        <div className="max-w-xl text-white"><h2 className="text-5xl font-bold leading-tight mb-9">{t('login.sideTitle')}</h2><p className="text-4xl leading-snug mb-10">{t('login.sideDescription')}</p><div className="inline-block px-5 py-3 rounded-full bg-[#a5ff9e] text-[#281078] text-sm font-semibold">{t('login.gift')}</div></div>
      </section>
    </main>
  )
}
export default ForgotPassword
