
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

export function useCredits() {
  const { user } = useAuth()

  const [balance, setBalance] = useState<number | null>(null)
  const [history, setHistory] = useState<CreditTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setBalance(null)
      setHistory([])
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const [profileRes, historyRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('credit_balance')
          .eq('id', user.id)
          .single(),

        supabase
          .from('credit_transactions')
          .select('id, amount, type, note, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

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
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  return {
    balance,
    history,
    loading,
    error,
    reload: load,
  }
}
