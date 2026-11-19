
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

type Skill = {
  id: number
  name: string
  category: string
  user_skill_id: number
  level: string | null
  description: string | null
  teacher: {
    id: string
    full_name: string
    avatar_url: string | null
  }
}

// Supabase sorğu nəticəsinin tipi (any əvəzinə)
type UserSkillRow = {
  id: number
  level: string | null
  description: string | null
  skills: {
    id: number
    name: string
    category: string
  } | null
  profiles: {
    id: string
    full_name: string
    avatar_url: string | null
  } | null
}

type CompleteUserSkillRow = UserSkillRow & {
  skills: NonNullable<UserSkillRow['skills']>
  profiles: NonNullable<UserSkillRow['profiles']>
}

// Supabase sorğu helper-i (setState yoxdur — komponent xaricində təmiz funksiya)
async function fetchUserSkills() {
  return supabase
    .from('user_skills')
    .select(`
      id,
      level,
      description,
      skills (
        id,
        name,
        category
      ),
      profiles (
        id,
        full_name,
        avatar_url
      )
    `)
    .eq('type', 'teach')
    .order('created_at', { ascending: false })
}

function Skills() {
  const { user } = useAuth()

  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Hamısı')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Booking modal states
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [durationHours, setDurationHours] = useState(1)
  const [message, setMessage] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [requestSuccess, setRequestSuccess] = useState('')

  useEffect(() => {
    if (!user) return

    let ignore = false

    // react.dev tövsiyəsi: fetch funksiyası effect daxilində,
    // bütün setState çağırışları await-dən SONRA olur
    async function loadSkills() {
      try {
        const { data, error } = await fetchUserSkills()

        if (ignore) return

        if (error) {
          setError(error.message)
          setLoading(false)
          return
        }

        // Supabase-jS tip çıxarışı relation-ları massiv kimi göstərir; runtime-da
        // many-to-one embed obyekt qaytarır — buna görə unknown üzərindən cast olunur
        const formatted: Skill[] =
          ((data ?? []) as unknown as UserSkillRow[])
            .filter(
              (item): item is CompleteUserSkillRow =>
                Boolean(item.skills && item.profiles)
            )
            .map(item => ({
              id: item.skills.id,
              name: item.skills.name,
              category: item.skills.category,
              user_skill_id: item.id,
              level: item.level,
              description: item.description,
              teacher: item.profiles,
            }))

        setSkills(formatted)
        setLoading(false)
      } catch (err: unknown) {
        if (ignore) return
        setError(err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.')
        setLoading(false)
      }
    }

    void loadSkills()

    return () => {
      ignore = true
    }
  }, [user])

  const categories = useMemo(
    () => ['Hamısı', ...Array.from(new Set(skills.map(s => s.category)))],
    [skills]
  )

  const filteredSkills = useMemo(() => {
    return skills.filter(skill => {
      const query = search.toLowerCase()

      const matchesSearch =
        skill.name.toLowerCase().includes(query) ||
        skill.category.toLowerCase().includes(query) ||
        skill.teacher.full_name.toLowerCase().includes(query)

      const matchesCategory =
        category === 'Hamısı' || skill.category === category

      return matchesSearch && matchesCategory
    })
  }, [skills, search, category])

  const teacherCount = useMemo(
    () => new Set(skills.map(s => s.teacher.id)).size,
    [skills]
  )

  const popularCategories = useMemo(
    () =>
      categories
        .filter(item => item !== 'Hamısı')
        .map(name => ({
          name,
          count: skills.filter(s => s.category === name).length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    [categories, skills]
  )

  const topTeachers = useMemo(() => {
    const teachers = new Map<
      string,
      { name: string; avatar: string | null; count: number }
    >()

    skills.forEach(skill => {
      const id = skill.teacher.id
      const current = teachers.get(id)

      if (current) {
        current.count += 1
      } else {
        teachers.set(id, {
          name: skill.teacher.full_name,
          avatar: skill.teacher.avatar_url,
          count: 1,
        })
      }
    })

    return Array.from(teachers.entries())
      .map(([id, teacher]) => ({ id, ...teacher }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
  }, [skills])

  // Create lesson request
  async function handleCreateRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!user || !selectedSkill || submitting) return

    if (user.id === selectedSkill.teacher.id) {
      setRequestError('Öz bacarığına sifariş göndərə bilməzsən.')
      return
    }

    setSubmitting(true)
    setRequestError('')

    try {
      const { error } = await supabase
        .from('lesson_requests')
        .insert({
          requester_id: user.id,
          teacher_id: selectedSkill.teacher.id,
          skill_id: selectedSkill.id,
          duration_hours: durationHours,
          message: message.trim() || null,
          scheduled_at: scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
          status: 'pending',
        })

      if (error) {
        setRequestError(error.message)
        return
      }

      setSelectedSkill(null)
      setDurationHours(1)
      setMessage('')
      setScheduledAt('')
      setRequestSuccess('Sorğun uğurla göndərildi!')
    } catch {
      setRequestError('Gözlənilməz xəta baş verdi. Yenidən cəhd et.')
    } finally {
      setSubmitting(false)
    }
  }

  function closeModal() {
    if (submitting) return

    setSelectedSkill(null)
    setDurationHours(1)
    setMessage('')
    setScheduledAt('')
    setRequestError('')
  }

  // Modal açılanda (event handler — render daxilində DEYİL) hesablanır
  const [minScheduledAt, setMinScheduledAt] = useState('')

  return (
    <main className="min-h-screen bg-white text-[#291078]">

      {/* SEARCH SECTION */}
      <section className="px-4 pb-12 pt-8">
        <div className="mx-auto max-w-[1000px]">

          <div className="text-center">
            <span className="inline-block rounded-full bg-[#f4e1fb] px-4 py-1.5 text-[10px] font-semibold text-[#8b20d5]">
              Gənclər üçün ödənişsiz bacarıq və vaxt mübadiləsi
            </span>

            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Bacarıq axtar
            </h1>

            <p className="mx-auto mt-2 max-w-lg text-xs leading-6 text-[#796b9e] sm:text-sm">
              Öyrənmək istədiyin bacarığı tap və ya özün bildiyini paylaş.
              Birlikdə öyrən, birlikdə inkişaf et!
            </p>
          </div>

          {/* Search */}
          <form
            onSubmit={e => e.preventDefault()}
            className="mx-auto mt-5 flex h-11 max-w-[530px] items-center rounded-xl border border-[#e8b2f8] bg-white p-1 shadow-sm focus-within:border-purple-500"
          >
            <span className="pl-3 text-[#9b7ab8]">⌕</span>

            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Bacarıq və ya ad axtar..."
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-xs outline-none"
            />

            <button
              type="submit"
              className="rounded-lg bg-[#861bd2] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#7015b5]"
            >
              Axtar
            </button>
          </form>

          {/* Popular searches */}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {['Python', 'İngilis dili', 'Gitara', 'Qrafik dizayn', 'UI/UX dizayn'].map(item => (
              <button
                key={item}
                onClick={() => setSearch(item)}
                className="rounded-full border border-[#ead0f6] bg-[#faf4fd] px-3 py-1 text-[10px] text-[#57318d] transition hover:bg-[#efd5fa]"
              >
                {item}
              </button>
            ))}
          </div>

          {/* Statistics */}
          <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-[#f8effd] p-4 text-center sm:grid-cols-3">
            <div>
              <p className="text-[10px] text-[#8065a8]">Paylaşılan bacarıqlar</p>
              <p className="mt-1 text-xl font-bold">{skills.length}</p>
            </div>

            <div>
              <p className="text-[10px] text-[#8065a8]">Bacarıq paylaşanlar</p>
              <p className="mt-1 text-xl font-bold">{teacherCount}</p>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <p className="text-[10px] text-[#8065a8]">Kateqoriyalar</p>
              <p className="mt-1 text-xl font-bold">
                {categories.length - 1}
              </p>
            </div>
          </div>

          {/* Category filters */}
          <div className="mt-5 flex flex-wrap gap-2">
            {categories.map(item => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-full border px-3 py-1.5 text-[10px] transition ${
                  category === item
                    ? 'border-[#8b20d5] bg-[#8b20d5] text-white'
                    : 'border-[#e8b9f7] bg-white text-[#57318d] hover:bg-[#f8effd]'
                }`}
              >
                {item === 'Hamısı' ? 'Bütün sahələr' : item}
              </button>
            ))}
          </div>

          {/* Skills */}
          <div className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Bacarıqlar</h2>
              <span className="text-[10px] text-[#8065a8]">
                {filteredSkills.length} nəticə
              </span>
            </div>

            {loading && (
              <p className="py-12 text-center text-sm text-[#8065a8]">
                Bacarıqlar yüklənir...
              </p>
            )}

            {error && (
              <p className="py-12 text-center text-sm text-red-600">
                Xəta: {error}
              </p>
            )}

            {!loading && !error && filteredSkills.length === 0 && (
              <p className="rounded-xl bg-[#faf4fd] py-12 text-center text-sm text-[#8065a8]">
                Axtarışa uyğun bacarıq tapılmadı.
              </p>
            )}

            {!loading && !error && filteredSkills.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSkills.map(skill => {
                  const isOwnSkill = user?.id === skill.teacher.id

                  return (
                    <article
                      key={skill.user_skill_id}
                      className="flex min-h-[205px] flex-col rounded-xl border border-[#eac8f5] bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <span className="w-fit rounded-full bg-[#f4e1fb] px-2.5 py-1 text-[9px] font-semibold text-[#8b20d5]">
                        {skill.category}
                      </span>

                      <h3 className="mt-3 text-sm font-bold">
                        {skill.name}
                      </h3>

                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[#efd4fa] text-xs font-bold text-[#8420cb]">
                          {skill.teacher.avatar_url ? (
                            <img
                              src={skill.teacher.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            skill.teacher.full_name.charAt(0).toUpperCase()
                          )}
                        </div>

                        <p className="text-[10px] font-medium text-[#604c85]">
                          {skill.teacher.full_name || 'İstifadəçi'}
                        </p>
                      </div>

                      {skill.level && (
                        <p className="mt-2 text-[10px] text-[#8065a8]">
                          Səviyyə: {skill.level}
                        </p>
                      )}

                      {skill.description && (
                        <p className="mt-2 line-clamp-2 text-[10px] leading-5 text-[#8065a8]">
                          {skill.description}
                        </p>
                      )}

                      <button
                        disabled={isOwnSkill}
                        onClick={() => {
                          setSelectedSkill(skill)
                          setRequestError('')
                          setRequestSuccess('')
                          setMinScheduledAt(
                            new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                              .toISOString()
                              .slice(0, 16)
                          )
                        }}
                        className="mt-auto w-full rounded-lg bg-[#861bd2] py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#7015b5] disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        {isOwnSkill ? 'Öz bacarığındır' : 'Seans sifariş et'}
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-[#fbf0fd] px-4 py-12">
        <div className="mx-auto max-w-[1000px]">
          <div className="text-center">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-[#a06ac4]">
              Sadə sistem
            </p>

            <h2 className="mt-2 text-xl font-bold">
              Platforma necə işləyir?
            </h2>

            <p className="mt-2 text-[11px] text-[#8065a8]">
              Biliklərini paylaş, yeni bacarıqlar qazan və vaxtını dəyərləndir.
            </p>
          </div>

          <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                number: '01',
                title: 'Bacarıqlarını paylaş',
                description: 'Bildiyin mövzuları digər gənclərə öyrət və öz biliklərini paylaş.',
              },
              {
                number: '02',
                title: 'Kredit balansını yarat',
                description: 'Dərs keçərək kredit qazan və öyrənmək üçün istifadə et.',
              },
              {
                number: '03',
                title: 'Yeni bacarıqlar öyrən',
                description: 'İstədiyin sahədə mentor tap və öyrənməyə başla.',
              },
            ].map(item => (
              <article
                key={item.number}
                className="rounded-xl border border-[#f0d8f8] bg-white p-5 text-center"
              >
                <span className="text-[11px] font-bold text-[#a34ad2]">
                  {item.number}
                </span>

                <h3 className="mt-3 text-sm font-bold">{item.title}</h3>

                <p className="mt-2 text-[10px] leading-5 text-[#8065a8]">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* POPULAR CATEGORIES */}
      <section className="px-4 py-12">
        <div className="mx-auto max-w-[1000px]">
          <div className="text-center">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-[#a06ac4]">
              İstək lövhəsi
            </p>

            <h2 className="mt-2 text-xl font-bold">
              Gənclər nə öyrənmək istəyir?
            </h2>

            <p className="mt-2 text-[11px] text-[#8065a8]">
              Müxtəlif sahələrdən bacarıqları kəşf et.
            </p>
          </div>

          <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {popularCategories.map(item => (
              <button
                key={item.name}
                onClick={() => {
                  setCategory(item.name)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="rounded-xl border border-[#ecd1f6] bg-white p-5 text-left transition hover:bg-[#fcf5ff] hover:shadow-sm"
              >
                <span className="text-xs font-bold text-[#8b20d5]">
                  {item.name}
                </span>

                <p className="mt-3 text-[10px] text-[#8065a8]">
                  {item.count} paylaşılmış bacarıq
                </p>

                <span className="mt-3 inline-block text-[10px] font-semibold text-[#8b20d5]">
                  Bacarıqlara bax →
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* TOP TEACHERS */}
      <section className="bg-[#fbf0fd] px-4 py-12">
        <div className="mx-auto max-w-[1000px]">
          <div className="text-center">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-[#a06ac4]">
              Paylaşım liderləri
            </p>

            <h2 className="mt-2 text-xl font-bold">
              Ən çox bacarıq paylaşan gənclər
            </h2>

            <p className="mt-2 text-[11px] text-[#8065a8]">
              Biliklərini paylaşaraq icmamızı inkişaf etdirənlər.
            </p>
          </div>

          {topTeachers.length > 0 ? (
            <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {topTeachers.map((teacher, index) => (
                <article
                  key={teacher.id}
                  className="rounded-xl border border-[#eed8f8] bg-white p-4 text-center"
                >
                  <span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-[#8b20d5] text-[10px] font-bold text-white">
                    {index + 1}
                  </span>

                  <div className="mx-auto mt-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#efd4fa] text-sm font-bold text-[#8420cb]">
                    {teacher.avatar ? (
                      <img
                        src={teacher.avatar}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      teacher.name.charAt(0).toUpperCase()
                    )}
                  </div>

                  <h3 className="mt-2 text-xs font-bold">
                    {teacher.name || 'İstifadəçi'}
                  </h3>

                  <p className="mt-2 text-[10px] text-[#8065a8]">
                    {teacher.count} bacarıq paylaşır
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-center text-xs text-[#8065a8]">
              Hələ paylaşım edən istifadəçi yoxdur.
            </p>
          )}
        </div>
      </section>

      {/* SUCCESS MESSAGE */}
      {requestSuccess && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl border border-green-200 bg-white px-5 py-4 shadow-lg">
          <p className="text-sm font-semibold text-green-700">
            ✓ {requestSuccess}
          </p>
          <button
            onClick={() => setRequestSuccess('')}
            className="mt-2 text-xs text-[#8065a8] underline"
          >
            Bağla
          </button>
        </div>
      )}

      {/* BOOKING MODAL */}
      {selectedSkill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#24105c]/50 px-4 py-6 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-2xl border border-[#eac8f5] bg-white p-6 shadow-2xl"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={closeModal}
              disabled={submitting}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#f8effd] text-lg text-[#8065a8] transition hover:bg-[#efdafa] disabled:opacity-50"
              aria-label="Bağla"
            >
              ×
            </button>

            <div className="mb-5">
              <span className="inline-block rounded-full bg-[#f4e1fb] px-3 py-1 text-[10px] font-semibold text-[#8b20d5]">
                Of Course · Seans sifarişi
              </span>

              <h2
                id="booking-title"
                className="mt-3 text-xl font-bold text-[#291078]"
              >
                Seans sifariş et
              </h2>

              <p className="mt-1 text-xs leading-5 text-[#8065a8]">
                Müəllimə dərs sorğusu göndərmək üçün məlumatları doldur.
              </p>
            </div>

            {/* Selected skill */}
            <div className="mb-5 rounded-xl border border-[#ecd1f6] bg-[#faf4fd] p-4">
              <p className="text-[10px] text-[#8065a8]">
                Seçilmiş bacarıq
              </p>

              <h3 className="mt-1 text-sm font-bold text-[#8b20d5]">
                {selectedSkill.name}
              </h3>

              <p className="mt-1 text-xs text-[#604c85]">
                Müəllim: {selectedSkill.teacher.full_name || 'İstifadəçi'}
              </p>

              <p className="mt-1 text-[10px] text-[#8065a8]">
                {selectedSkill.category}
              </p>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-4">

              {/* Duration */}
              <div>
                <label
                  htmlFor="duration"
                  className="mb-2 block text-xs font-semibold text-[#291078]"
                >
                  Seans müddəti
                </label>

                <select
                  id="duration"
                  value={durationHours}
                  onChange={e => setDurationHours(Number(e.target.value))}
                  className="w-full rounded-xl border border-[#e8b9f7] bg-white px-3 py-3 text-xs text-[#291078] outline-none transition focus:border-[#8b20d5]"
                >
                  <option value={1}>1 saat · 1 kredit</option>
                  <option value={2}>2 saat · 2 kredit</option>
                  <option value={3}>3 saat · 3 kredit</option>
                  <option value={4}>4 saat · 4 kredit</option>
                </select>
              </div>

              {/* Date and time */}
              <div>
                <label
                  htmlFor="scheduledAt"
                  className="mb-2 block text-xs font-semibold text-[#291078]"
                >
                  İstədiyin tarix və saat
                  <span className="ml-1 font-normal text-[#a58ab9]">
                    (İstəyə bağlı)
                  </span>
                </label>

                <input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  min={minScheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="w-full rounded-xl border border-[#e8b9f7] bg-white px-3 py-3 text-xs text-[#291078] outline-none transition focus:border-[#8b20d5]"
                />
              </div>

              {/* Message */}
              <div>
                <label
                  htmlFor="bookingMessage"
                  className="mb-2 block text-xs font-semibold text-[#291078]"
                >
                  Müəllimə mesajın
                  <span className="ml-1 font-normal text-[#a58ab9]">
                    (İstəyə bağlı)
                  </span>
                </label>

                <textarea
                  id="bookingMessage"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Hansı mövzunu öyrənmək istədiyini yaza bilərsən..."
                  className="w-full resize-none rounded-xl border border-[#e8b9f7] bg-white px-3 py-3 text-xs text-[#291078] outline-none transition placeholder:text-[#b49ac5] focus:border-[#8b20d5]"
                />

                <p className="mt-1 text-right text-[10px] text-[#a58ab9]">
                  {message.length}/500
                </p>
              </div>

              {/* Error */}
              {requestError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-600">
                  {requestError}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#861bd2] py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#7015b5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Göndərilir...' : 'Sorğunu göndər'}
              </button>

              <p className="text-center text-[10px] leading-5 text-[#8065a8]">
                Sorğu müəllimə göndəriləcək. Kreditlər dərs tamamlandıqdan sonra hesablanacaq.
              </p>
            </form>
          </div>
        </div>
      )}

    </main>
  )
}

export default Skills
