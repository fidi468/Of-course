/**
 * useReports — istifadəçi şikayətləri və admin moderasiya üçün hook.
 *
 - İstifadəçi öz şikayətlərini görə bilər
 - Admin bütün şikayətləri görə bilər
 - submit_report, resolve_report, suspend_user RPC-lərini çağırır
 */

import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './useAuth'

type ReportRow = {
  id: number
  reporter_id: string
  reported_id: string
  reason: string
  description: string | null
  status: string
  created_at: string
  resolved_by: string | null
  resolution_note: string | null
}

type UseReportsResult = {
  reports: ReportRow[]
  loading: boolean
  error: string | null
  loadReports: () => Promise<void>
  submitReport: (
    reportedId: string,
    reason: string,
    description?: string
  ) => Promise<{ error: string | null }>
  resolveReport: (
    reportId: number,
    status: 'resolved' | 'dismissed',
    note?: string
  ) => Promise<{ error: string | null }>
}

export function useReports(): UseReportsResult {
  const { user } = useAuth()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadReports = useCallback(async () => {
    if (!user) {
      setReports([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error: err } = await supabase
      .from('user_reports')
      .select('*')
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
    } else {
      setReports((data ?? []) as ReportRow[])
      setError(null)
    }
    setLoading(false)
  }, [user])

  const submitReport = useCallback(
    async (
      reportedId: string,
      reason: string,
      description?: string
    ): Promise<{ error: string | null }> => {
      const { error: err } = await supabase.rpc('submit_report', {
        p_reported_id: reportedId,
        p_reason: reason,
        p_description: description ?? null,
      })

      if (err) return { error: err.message }
      return { error: null }
    },
    []
  )

  const resolveReport = useCallback(
    async (
      reportId: number,
      status: 'resolved' | 'dismissed',
      note?: string
    ): Promise<{ error: string | null }> => {
      const { error: err } = await supabase.rpc('resolve_report', {
        p_report_id: reportId,
        p_status: status,
        p_resolution_note: note ?? null,
      })

      if (err) return { error: err.message }
      await loadReports()
      return { error: null }
    },
    [loadReports]
  )

  return {
    reports,
    loading,
    error,
    loadReports,
    submitReport,
    resolveReport,
  }
}
