
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

/**
 * Şifrə bərpa linki istənilən səhifəyə düşərsə (məsələn, Supabase-in
 * Redirect URLs siyahısında domain yoxdursa, istifadəçi əsas URL-ə yönəlir),
 * PASSWORD_RECOVERY hadisəsi tutulur və istifadəçi avtomatik
 * /reset-password səhifəsinə yönləndirilir — beləcə bərpa forması
 * heç vaxt itmir.
 */
export default function RecoveryRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true })
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [navigate])

  return null
}
