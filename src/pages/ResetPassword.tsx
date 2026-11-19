import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'

type Mode = 'checking' | 'form' | 'code' | 'no-session'

function ResetPassword() {
  const { updatePassword } = useAuth()
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()

  const [mode, setMode] = useState<Mode>('checking')

  // Form rejimi (link işlədikdə / bərpa sess qurulanda)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Kod rejimi (link açılmadıqda)
  const [codeEmail, setCodeEmail] = useState('')
  const [codeToken, setCodeToken] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeError, setCodeError] = useState('')

  useEffect(() => {
    const wantsCode = searchParams.get('mode') === 'code'

    // Bərpa hadisəsi bu komponent mount olmamışdan əvvəl gəlsə belə,
    // getSession nəticəsi sessi varsa formanı açır
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('form')
      }
    })

    supabase.auth
      .getSession()
      .then(({ data: sessionData }) => {
        if (sessionData.session) {
          setMode('form')
        } else {
          setMode(wantsCode ? 'code' : 'no-session')
        }
      })
      .catch(() => {
        setMode(wantsCode ? 'code' : 'no-session')
      })

    return () => listener.subscription.unsubscribe()
  }, [searchParams])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (password !== confirmPassword) { setError(t('reset.passwordMismatch')); return }
    if (password.length < 6) { setError(t('reset.passwordShort')); return }
    setLoading(true)

    try {
      const result = await updatePassword(password)
      if (result.error) setError(t('reset.error'))
      else { setMessage(t('reset.success')); setPassword(''); setConfirmPassword('') }
    } catch (err) {
      console.error('Password update error:', err)
      setError(t('reset.error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCodeError('')
    setCodeLoading(true)

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: codeEmail.trim(),
        token: codeToken.trim(),
        type: 'recovery',
      })

      if (error) {
        setCodeError(error.message)
        return
      }

      // Kod təsdiqləndi — bərpa sessiyası quruldu, şifrə forması açılır
      setMode('form')
    } catch (err) {
      console.error('OTP verification error:', err)
      setCodeError(t('reset.error'))
    } finally {
      setCodeLoading(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-80px)] grid grid-cols-1 lg:grid-cols-2">
      <section className="bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="text-3xl font-bold text-[#281078]">Of Course</Link>

          {mode === 'checking' && (
            <p className="mt-10 text-sm text-[#604c85]">{t('common.loading')}</p>
          )}

          {/* NORMAL REJİM: yeni şifrə forması */}
          {mode === 'form' && (
            <>
              <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">{t('reset.title')}</h1>
              <p className="text-lg text-[#281078] mb-9">{t('reset.subtitle')}</p>
              <form onSubmit={handleSubmit} className="space-y-7">
                <div><label className="block text-sm mb-2">{t('reset.password')}</label><input type="password" placeholder={t('reset.passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]" /></div>
                <div><label className="block text-sm mb-2">{t('reset.confirmPassword')}</label><input type="password" placeholder={t('reset.confirmPlaceholder')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]" /></div>
                <button type="submit" disabled={loading} className="w-full h-[58px] rounded-xl bg-[#8520d0] text-white font-semibold hover:bg-[#6f18b5] transition disabled:opacity-60">{loading ? t('reset.loading') : t('reset.submit')}</button>
              </form>
              {error && <p role="alert" className="text-red-600 mt-4 text-sm">{error}</p>}
              {message && <div className="mt-5 text-sm text-green-700"><p>{message}</p><Link to="/login" className="inline-block mt-3 text-[#9225d8] font-semibold hover:underline">{t('reset.back')}</Link></div>}
            </>
          )}

          {/* KOD REJİMİ: link açılmadıqda e-poçtdakı kodla daxil ol */}
          {mode === 'code' && (
            <>
              <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">{t('reset.codeTitle')}</h1>
              <p className="text-lg text-[#281078] mb-9">{t('reset.codeSubtitle')}</p>
              <form onSubmit={handleVerifyCode} className="space-y-7">
                <div>
                  <label className="block text-sm mb-2">{t('common.email')}</label>
                  <input
                    type="email"
                    placeholder={t('common.emailPlaceholder')}
                    value={codeEmail}
                    onChange={(e) => setCodeEmail(e.target.value)}
                    required
                    className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8]"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-2">{t('reset.codeLabel')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={codeToken}
                    onChange={(e) => setCodeToken(e.target.value)}
                    required
                    className="w-full h-[58px] px-5 rounded-xl border-2 border-[#edc4fa] focus:outline-none focus:border-[#9225d8] tracking-[0.4em] text-center"
                  />
                </div>
                <button type="submit" disabled={codeLoading} className="w-full h-[58px] rounded-xl bg-[#8520d0] text-white font-semibold hover:bg-[#6f18b5] transition disabled:opacity-60">{codeLoading ? t('reset.codeChecking') : t('reset.codeSubmit')}</button>
              </form>
              {codeError && <p role="alert" className="text-red-600 mt-4 text-sm">{codeError}</p>}
              <div className="text-right mt-7"><Link to="/forgot-password" className="text-sm text-[#9225d8] hover:underline">{t('forgot.back')}</Link></div>
            </>
          )}

          {/* LINK İŞLƏMƏDİ: yardım paneli */}
          {mode === 'no-session' && (
            <>
              <h1 className="text-4xl font-bold text-[#281078] mt-10 mb-2">{t('reset.linkProblemTitle')}</h1>
              <p className="text-lg text-[#281078] mb-9">{t('reset.linkProblemText')}</p>
              <div className="space-y-4">
                <button
                  onClick={() => setMode('code')}
                  className="w-full h-[58px] rounded-xl bg-[#8520d0] text-white font-semibold hover:bg-[#6f18b5] transition"
                >
                  {t('reset.continueWithCode')}
                </button>
                <Link
                  to="/forgot-password"
                  className="block w-full h-[58px] leading-[58px] text-center rounded-xl border-2 border-[#edc4fa] text-[#8520d0] font-semibold hover:bg-[#faf4fd] transition"
                >
                  {t('reset.getNewLink')}
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="hidden lg:flex items-center justify-center px-12 py-16 bg-gradient-to-br from-[#321080] via-[#7615b9] to-[#9d16d8]">
        <div className="max-w-xl text-white"><h2 className="text-5xl font-bold leading-tight mb-9">{t('login.sideTitle')}</h2><p className="text-4xl leading-snug mb-10">{t('login.sideDescription')}</p><div className="inline-block px-5 py-3 rounded-full bg-[#a5ff9e] text-[#281078] text-sm font-semibold">{t('login.gift')}</div></div>
      </section>
    </main>
  )
}
export default ResetPassword
