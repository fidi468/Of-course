// src/lib/lessonApi.js
// Bütün seans əməliyyatları bir yerdə. Frontend (Fidan) bu funksiyaları düymələrə qoşur.
// Qeyd: '../supabaseClient' yolunu FM-in yaratdığı faylın yerinə görə düzəlt.
import { supabase } from './supabaseClient'
// Öyrənən: yeni seans sorğusu göndərir (balans yetərli deyilsə baza xəta qaytarır)
export async function sendLessonRequest({ requesterId, teacherId, skillId, durationHours = 1, message = '' }) {
  const { data, error } = await supabase
    .from('lesson_requests')
    .insert({
      requester_id: requesterId,
      teacher_id: teacherId,
      skill_id: skillId,
      duration_hours: durationHours,
      message,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Müəllim: sorğunu qəbul (true) və ya rədd (false) edir
export async function respondToRequest(requestId, accept) {
  const { error } = await supabase.rpc('respond_to_request', {
    p_request_id: requestId,
    p_accept: accept,
  })
  if (error) throw error
}

// Müəllim: seans bitdi, kredit avtomatik köçür
export async function completeLesson(requestId) {
  const { error } = await supabase.rpc('complete_lesson', { p_request_id: requestId })
  if (error) throw error
}

// İki tərəfdən biri: sorğunu ləğv edir
export async function cancelRequest(requestId) {
  const { error } = await supabase.rpc('cancel_request', { p_request_id: requestId })
  if (error) throw error
}

// Mənim göndərdiyim və mənə gələn sorğular (Requests səhifəsi üçün)
export async function fetchMyRequests(userId) {
  const { data, error } = await supabase
    .from('lesson_requests')
    .select(`
      id, status, duration_hours, message, created_at,
      skill:skills(name),
      requester:profiles!lesson_requests_requester_id_fkey(id, full_name),
      teacher:profiles!lesson_requests_teacher_id_fkey(id, full_name)
    `)
    .or(`requester_id.eq.${userId},teacher_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}
