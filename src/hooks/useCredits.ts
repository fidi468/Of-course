
import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './useAuth'

type CreditTransaction = {
  id: number
  amount: number
  type: string
  note: string | null
  created_at: string
}

// Supabase sorğu helper-i (setState yoxdur — komponent xaricində təmiz funksiya)
function fetchCreditData(userId: string) {
  return Promise.all([
    supabase
      .from('profiles')
      .select('credit_balance')
      .eq('id', userId)
      .single(),

    supabase
      .from('credit_transactions')
      .select('id, amount, type, note, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])
}

export function useCredits() {
  const { user, loading: authLoading } = useAuth()

  const [balance, setBalance] = useState<number | null>(null)
  const [history, setHistory] = useState<CreditTransaction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // react.dev tövsiyəsi: fetch funksiyası effect daxilində,
  // bütün setState çağırışları await-dən SONRA olur
  useEffect(() => {
    if (!user) return

    let ignore = false
    const userId = user.id

    async function loadCredits() {
      try {
        const [profileRes, historyRes] = await fetchCreditData(userId)

        if (ignore) return

        if (profileRes.error) throw profileRes.error
        if (historyRes.error) throw historyRes.error

        setBalance(profileRes.data.credit_balance)
        setHistory(historyRes.data ?? [])
        setError(null)
      } catch (err: unknown) {
        if (ignore) return

        setError(
          err instanceof Error
            ? err.message
            : 'Kredit məlumatları yüklənmədi.'
        )
      } finally {
        if (!ignore) setLoaded(true)
      }
    }

    void loadCredits()

    return () => {
      ignore = true
    }
  }, [user])

  // Xəta hallarında "yenidən cəhd et" düyməsi üçün səssiz yeniləmə
  const reload = useCallback(async () => {
    if (!user) return

    const userId = user.id

    try {
      const [profileRes, historyRes] = await fetchCreditData(userId)

      if (profileRes.error) throw profileRes.error
      if (historyRes.error) throw historyRes.error

      setBalance(profileRes.data.credit_balance)
      setHistory(historyRes.data ?? [])
      setError(null)
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Kredit məlumatları yüklənmədi.'
      )
    } finally {
      setLoaded(true)
    }
  }, [user])

  return {
    balance,
    history,
    // Auth həll olunmayanadək və ya ilk yüklənmə bitməyənədək yüklənmə statusu
    loading: authLoading || (!loaded && !!user),
    error,
    reload,
  }
}
