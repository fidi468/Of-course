/**
 * Supabase auth xətalarını yerli dilə çevrilmiş i18n açarlarına map edir.
 *
 * Supabase xəta mesajları həmişə ingiliscə gəlir ("Email rate limit exceeded",
 * "Invalid login credentials" və s.) — bu helper hər xəta kodunu / mesajını
 * dörd dildə də mövcud olan `errors.*` açarına çevirir, beləcə istifadəçi
 * seçdiyi dildə konsistent xəta görür.
 */

type ErrorLike = {
  code?: string
  message?: string | null
  status?: number
} | null | undefined

export function authErrorKey(error: ErrorLike): string {
  if (!error) return 'errors.generic'

  const message = (error.message ?? '').toLowerCase()
  const code = (error.code ?? '').toLowerCase()

  // 1) E-poçt limiti — Supabase pulsuz plan: 2 e-poçt / saat
  //    (code: over_email_send_rate_limit, status: 429)
  if (
    code === 'over_email_send_rate_limit' ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('too many emails')
  ) {
    return 'errors.rateLimit'
  }

  // 2) Yanlış e-poçt / şifrə
  if (
    code === 'invalid_credentials' ||
    message.includes('invalid login credentials') ||
    message.includes('invalid username or password')
  ) {
    return 'errors.invalidCredentials'
  }

  // 3) E-poçt təsdiqlənməyib
  if (
    code === 'email_not_confirmed' ||
    message.includes('email not confirmed')
  ) {
    return 'errors.emailNotConfirmed'
  }

  // 4) Artıq qeydiyyatdan keçib
  if (
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('has been registered')
  ) {
    return 'errors.alreadyRegistered'
  }

  // 5) Zəif şifrə (Supabase: "Password should be at least X characters")
  if (
    code === 'weak_password' ||
    message.includes('weak password') ||
    message.includes('password should be') ||
    (message.includes('password') && message.includes('least'))
  ) {
    return 'errors.weakPassword'
  }

  // 6) Yanlış e-poçt formatı
  if (
    message.includes('invalid format') ||
    message.includes('invalid email') ||
    (code === 'validation_failed' && message.includes('email'))
  ) {
    return 'errors.invalidEmail'
  }

  // 7) OTP / bərpa kodu yanlışdır və ya vaxtı keçib
  if (
    code === 'otp_expired' ||
    message.includes('otp') ||
    message.includes('token has expired') ||
    message.includes('invalid token') ||
    message.includes('expired')
  ) {
    return 'errors.invalidOtp'
  }

  // 8) Şəbəkə xətası
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('connection')
  ) {
    return 'errors.network'
  }

  return 'errors.generic'
}
