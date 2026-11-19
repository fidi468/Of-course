import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'

function ForgotPassword() {
  const { resetPassword } = useAuth()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const result = await resetPassword(email)
      if (result.error) setError(t('forgot.error'))
      else setMessage(t('forgot.success'))
    } catch (err) {
      console.error('Password reset error:', err)
      setError(t('forgot.error'))
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
            <button type="submit" disabled={loading} className="w-full h-[58px] rounded-xl bg-[#8520d0] text-white font-semibold hover:bg-[#6f18b5] transition disabled:opacity-60">{loading ? t('forgot.loading') : t('forgot.submit')}</button>
          </form>
          {error && <p role="alert" className="text-red-600 mt-4 text-sm">{error}</p>}
          {message && <p role="status" className="text-green-600 mt-4 text-sm">{message}</p>}
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
