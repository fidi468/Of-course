import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'

function ResetPassword() {
  const { updatePassword } = useAuth()
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (password !== confirmPassword) { setError(t('reset.passwordMismatch')); return }
    if (password.length < 6) { setError(t('reset.passwordShort')); return }
    setLoading(true)
    const result = await updatePassword(password)
    if (result.error) setError(t('reset.error'))
    else { setMessage(t('reset.success')); setPassword(''); setConfirmPassword('') }
    setLoading(false)
  }

  return (
    <main className="min-h-[calc(100vh-80px)] grid grid-cols-1 lg:grid-cols-2">
      <section className="bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="text-3xl font-bold text-[#281078]">Of Course</Link>
          <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">{t('reset.title')}</h1>
          <p className="text-lg text-[#281078] mb-9">{t('reset.subtitle')}</p>
          <form onSubmit={handleSubmit} className="space-y-7">
            <div><label className="block text-sm mb-2">{t('reset.password')}</label><input type="password" placeholder={t('reset.passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]" /></div>
            <div><label className="block text-sm mb-2">{t('reset.confirmPassword')}</label><input type="password" placeholder={t('reset.confirmPlaceholder')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} required className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]" /></div>
            <button type="submit" disabled={loading} className="w-full h-[58px] rounded-xl bg-[#8520d0] text-white font-semibold hover:bg-[#6f18b5] transition disabled:opacity-60">{loading ? t('reset.loading') : t('reset.submit')}</button>
          </form>
          {error && <p role="alert" className="text-red-600 mt-4 text-sm">{error}</p>}
          {message && <div className="mt-5 text-sm text-green-700"><p>{message}</p><Link to="/login" className="inline-block mt-3 text-[#9225d8] font-semibold hover:underline">{t('reset.back')}</Link></div>}
        </div>
      </section>
      <section className="hidden lg:flex items-center justify-center px-12 py-16 bg-gradient-to-br from-[#321080] via-[#7615b9] to-[#9d16d8]">
        <div className="max-w-xl text-white"><h2 className="text-5xl font-bold leading-tight mb-9">{t('login.sideTitle')}</h2><p className="text-4xl leading-snug mb-10">{t('login.sideDescription')}</p><div className="inline-block px-5 py-3 rounded-full bg-[#a5ff9e] text-[#281078] text-sm font-semibold">{t('login.gift')}</div></div>
      </section>
    </main>
  )
}
export default ResetPassword
