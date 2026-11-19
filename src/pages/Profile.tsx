
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

type ProfileRow = {
  full_name: string
  bio: string | null
  avatar_url: string | null
  university: string | null
  credit_balance: number
}

type SkillType = 'teach' | 'learn'

type MySkill = {
  id: number
  type: SkillType
  level: string | null
  description: string | null
  skills: { id: number; name: string; category: string } | null
}

type SkillCatalogItem = { id: number; name: string; category: string }

type ReviewRow = {
  id: number
  rating: number
  comment: string | null
  created_at: string
  reviewer: { id: string; full_name: string; avatar_url: string | null } | null
  skill: { id: number; name: string } | null
}

type PageStats = {
  teachingHours: number
  learningHours: number
  completedSessions: number
}

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Başlanğıc',
  intermediate: 'Orta səviyyə',
  advanced: 'İnkişaf etmiş',
}

// --- Supabase sorğu helper-ləri (setState yoxdur — komponent xaricində təmiz funksiyalar) ---

function fetchProfile(userId: string) {
  return supabase
    .from('profiles')
    .select('full_name, bio, avatar_url, university, credit_balance')
    .eq('id', userId)
    .single()
}

function fetchMySkills(userId: string) {
  return supabase
    .from('user_skills')
    .select('id, type, level, description, skills(id, name, category)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
}

function fetchSkillCatalog() {
  return supabase
    .from('skills')
    .select('id, name, category')
    .order('category', { ascending: true })
    .order('name', { ascending: true })
}

function fetchCreditStats(userId: string) {
  return supabase
    .from('credit_transactions')
    .select('type, amount')
    .eq('user_id', userId)
}

function fetchCompletedSessionCount(userId: string) {
  return supabase
    .from('lesson_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .or(`requester_id.eq.${userId},teacher_id.eq.${userId}`)
}

function fetchMyReviews(userId: string) {
  return supabase
    .from('reviews')
    .select(`
      id,
      rating,
      comment,
      created_at,
      reviewer:profiles!reviews_reviewer_id_fkey (
        id,
        full_name,
        avatar_url
      ),
      skill:skills (
        id,
        name
      )
    `)
    .eq('teacher_id', userId)
    .order('created_at', { ascending: false })
    .limit(6)
}

function initialsOf(fullName: string) {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'U'
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('az-AZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function Profile() {
  const { user, signOut, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [mySkills, setMySkills] = useState<MySkill[]>([])
  const [stats, setStats] = useState<PageStats>({
    teachingHours: 0,
    learningHours: 0,
    completedSessions: 0,
  })
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null)
  const [reviewsAvailable, setReviewsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  // Bacarıq tabları: Öyrətdiklərim / Öyrəndiklərim
  const [activeTab, setActiveTab] = useState<SkillType>('teach')

  // Bacarıq əməliyyatları
  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([])
  const [busySkillId, setBusySkillId] = useState<number | null>(null)

  // Modallar
  const [profileModal, setProfileModal] = useState(false)
  const [editFullName, setEditFullName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [editAvatarUrl, setEditAvatarUrl] = useState('')
  const [editUniversity, setEditUniversity] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')

  const [editSkill, setEditSkill] = useState<MySkill | null>(null)
  const [editLevel, setEditLevel] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [skillSaving, setSkillSaving] = useState(false)
  const [skillError, setSkillError] = useState('')

  const [addModal, setAddModal] = useState(false)
  // Navbar "Bacarıq paylaş" düyməsi /profile?add=1 ilə gəlir —
  // modalın açıqlığı URL-dən törəmiş (derived) halda hesablanır
  const addParam = searchParams.get('add') === '1'
  const addModalOpen = addModal || addParam
  const [addType, setAddType] = useState<SkillType>('teach')
  const [addSkillId, setAddSkillId] = useState('')
  const [addLevel, setAddLevel] = useState('beginner')
  const [addDescription, setAddDescription] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const [pwdModal, setPwdModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdError, setPwdError] = useState('')
  const [pwdSuccess, setPwdSuccess] = useState('')

  // Bacarıq siyahısını səssiz yeniləyir (əməliyyatlardan sonra)
  const reloadSkills = useCallback(async () => {
    if (!user) return

    const { data, error } = await fetchMySkills(user.id)

    if (error) {
      setPageError(error.message)
      return
    }

    setMySkills(((data ?? []) as unknown) as MySkill[])
  }, [user])

  // react.dev tövsiyəsi: bütün setState çağırışları await-dən SONRA olur
  useEffect(() => {
    if (!user) return

    let ignore = false
    const userId = user.id

    async function loadAll() {
      setLoading(true)
      setPageError('')

      try {
        const [profileRes, skillsRes, statsRes, sessionsRes, reviewsRes] =
          await Promise.all([
            fetchProfile(userId),
            fetchMySkills(userId),
            fetchCreditStats(userId),
            fetchCompletedSessionCount(userId),
            fetchMyReviews(userId),
          ])

        if (ignore) return

        if (profileRes.error) throw profileRes.error

        setProfile(profileRes.data as unknown as ProfileRow)
        setMySkills(((skillsRes.data ?? []) as unknown) as MySkill[])

        const transactions = statsRes.data ?? []
        const teachingHours = transactions
          .filter(item => item.type === 'lesson_earned')
          .reduce((sum, item) => sum + item.amount, 0)
        const learningHours = transactions
          .filter(item => item.type === 'lesson_spent')
          .reduce((sum, item) => sum + Math.abs(item.amount), 0)
        const completedSessions = sessionsRes.error
          ? 0
          : sessionsRes.count ?? 0

        setStats({ teachingHours, learningHours, completedSessions })

        // reviews cədvəli mövcud deyilsə səhifə dağılmasın — boş vəziyyət göstərilir
        if (reviewsRes.error) {
          setReviews(null)
          setReviewsAvailable(false)
        } else {
          setReviews((reviewsRes.data ?? []) as unknown as ReviewRow[])
          setReviewsAvailable(true)
        }
      } catch (err: unknown) {
        if (ignore) return

        setPageError(
          err instanceof Error
            ? err.message
            : 'Profil məlumatları yüklənmədi.'
        )
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void loadAll()

    return () => {
      ignore = true
    }
  }, [user])

  // Bacarıq katalogu modal açılanda (düymədən VƏ YA ?add=1 linkindən) yüklənsin
  useEffect(() => {
    if (!addModalOpen || catalog.length > 0) return

    let ignore = false

    fetchSkillCatalog().then(({ data, error }) => {
      if (ignore) return

      if (error) {
        setAddError(error.message)
        return
      }

      setCatalog(((data ?? []) as unknown) as SkillCatalogItem[])
    })

    return () => {
      ignore = true
    }
  }, [addModalOpen, catalog.length])

  const teachSkills = useMemo(
    () => mySkills.filter(item => item.type === 'teach'),
    [mySkills]
  )

  const learnSkills = useMemo(
    () => mySkills.filter(item => item.type === 'learn'),
    [mySkills]
  )

  const tabSkills = activeTab === 'teach' ? teachSkills : learnSkills

  function openEditProfileModal() {
    if (!profile) return

    setEditFullName(profile.full_name)
    setEditBio(profile.bio ?? '')
    setEditAvatarUrl(profile.avatar_url ?? '')
    setEditUniversity(profile.university ?? '')
    setProfileError('')
    setProfileModal(true)
  }

  function openEditSkillModal(skill: MySkill) {
    setEditSkill(skill)
    setEditLevel(skill.level ?? 'beginner')
    setEditDescription(skill.description ?? '')
    setSkillError('')
  }

  function openAddModal(type: SkillType) {
    setAddModal(true)
    setAddType(type)
    setAddError('')
    setAddSkillId('')
    setAddLevel('beginner')
    setAddDescription('')
  }

  function closeAllSkillModals() {
    setEditSkill(null)
    setAddModal(false)
    setSkillError('')
    setAddError('')

    if (addParam) {
      setSearchParams({}, { replace: true })
    }
  }

  async function handleSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!user || !profile) return

    setProfileSaving(true)
    setProfileError('')

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editFullName.trim(),
          bio: editBio.trim() || null,
          avatar_url: editAvatarUrl.trim() || null,
          university: editUniversity.trim() || null,
        })
        .eq('id', user.id)

      if (error) {
        setProfileError(error.message)
        return
      }

      setProfile({
        ...profile,
        full_name: editFullName.trim(),
        bio: editBio.trim() || null,
        avatar_url: editAvatarUrl.trim() || null,
        university: editUniversity.trim() || null,
      })
      setProfileModal(false)
    } catch (err: unknown) {
      setProfileError(
        err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.'
      )
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleSaveSkill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!editSkill) return

    setSkillSaving(true)
    setSkillError('')

    try {
      const { error } = await supabase
        .from('user_skills')
        .update({
          level: editLevel,
          description: editDescription.trim() || null,
        })
        .eq('id', editSkill.id)

      if (error) {
        setSkillError(error.message)
        return
      }

      setEditSkill(null)
      await reloadSkills()
    } catch (err: unknown) {
      setSkillError(
        err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.'
      )
    } finally {
      setSkillSaving(false)
    }
  }

  async function handleAddSkill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!user || !addSkillId) return

    setAddSaving(true)
    setAddError('')

    try {
      const { error } = await supabase.from('user_skills').insert({
        user_id: user.id,
        skill_id: Number(addSkillId),
        type: addType,
        level: addLevel,
        description: addDescription.trim() || null,
      })

      if (error) {
        setAddError(error.message)
        return
      }

      setActiveTab(addType)
      setAddModal(false)

      if (addParam) {
        setSearchParams({}, { replace: true })
      }

      await reloadSkills()
    } catch (err: unknown) {
      setAddError(
        err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.'
      )
    } finally {
      setAddSaving(false)
    }
  }

  async function handleDeleteSkill(skillId: number) {
    if (busySkillId !== null) return

    const confirmed = window.confirm(
      'Bu bacarığı silmək istəyirsən? Bu əməliyyatı geri qaytarmaq olmaz.'
    )

    if (!confirmed) return

    setBusySkillId(skillId)

    try {
      const { error } = await supabase
        .from('user_skills')
        .delete()
        .eq('id', skillId)

      if (error) {
        setPageError(error.message)
        return
      }

      await reloadSkills()
    } catch (err: unknown) {
      setPageError(
        err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.'
      )
    } finally {
      setBusySkillId(null)
    }
  }

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (newPassword !== confirmNewPassword) {
      setPwdError('Şifrələr bir-biri ilə uyğun gəlmir.')
      return
    }

    if (newPassword.length < 6) {
      setPwdError('Şifrə ən azı 6 simvol olmalıdır.')
      return
    }

    setPwdSaving(true)
    setPwdError('')
    setPwdSuccess('')

    try {
      const { error } = await updatePassword(newPassword)

      if (error) {
        setPwdError(error.message)
        return
      }

      setPwdSuccess('Şifrə uğurla dəyişdirildi!')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (err: unknown) {
      setPwdError(
        err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.'
      )
    } finally {
      setPwdSaving(false)
    }
  }

  async function handleSignOut() {
    const { error } = await signOut()

    if (!error) {
      navigate('/', { replace: true })
    } else {
      console.error('Sign out error:', error)
    }
  }

  const initials = useMemo(
    () => (profile?.full_name ? initialsOf(profile.full_name) : 'U'),
    [profile]
  )

  const rating = useMemo(() => {
    if (!reviews || reviews.length === 0) return null

    const avg =
      reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length

    return avg.toFixed(1)
  }, [reviews])

  if (loading) {
    return (
      <div className="rounded-3xl bg-[#faf9fd] px-4 py-20 text-center sm:px-8">
        <p className="text-sm text-[#89859A]">Profil yüklənir...</p>
      </div>
    )
  }

  if (pageError && !profile) {
    return (
      <div className="rounded-3xl bg-[#faf9fd] px-4 py-20 sm:px-8">
        <div className="flex flex-col items-center justify-center gap-3 text-sm text-red-600">
          <p>{pageError}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-purple-600 px-5 py-2 text-white transition hover:bg-purple-700"
          >
            Yenidən cəhd et
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-3xl bg-[#faf9fd] p-4 text-[#29243A] sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* 1. SƏHİFƏ BAŞLIĞI */}
        <header>
          <p className="text-sm font-semibold text-purple-500">
            OF COURSE / PROFİL
          </p>
          <h1 className="mt-2 text-3xl font-bold">
            Mənim profilim
          </h1>
          <p className="mt-1 text-[#89859A]">
            Öyrənmə yolculuğunu buradan idarə et.
          </p>
        </header>

        {pageError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
            {pageError}
          </div>
        )}

        {/* 2. PROFİL BAŞLIQ KARTI */}
        <section className="rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-center">

            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.full_name || 'İstifadəçi'}
                className="h-24 w-24 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-200 to-pink-200 text-2xl font-bold text-purple-700">
                {initials}
              </div>
            )}

            <div className="min-w-0 flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold">
                {profile?.full_name || 'İstifadəçi'}
              </h2>

              {profile?.university && (
                <p className="text-[#89859A]">
                  {profile.university}
                </p>
              )}

              {profile?.bio && (
                <p className="mt-2 text-sm text-[#89859A]">
                  {profile.bio}
                </p>
              )}

              <p className="mt-2 font-medium text-purple-500">
                {rating ? (
                  <>★★★★★ {rating} · {reviews?.length} rəy</>
                ) : (
                  <span className="text-[#89859A]">Hələ rəy yoxdur</span>
                )}
              </p>
            </div>

            <div className="flex flex-col items-center gap-2 md:items-end">
              <button
                onClick={openEditProfileModal}
                className="rounded-xl bg-purple-100 px-5 py-3 font-semibold text-purple-700 transition hover:bg-purple-200"
              >
                Profili redaktə et
              </button>
              <div className="flex items-center gap-4 text-xs">
                <button
                  onClick={() => setPwdModal(true)}
                  className="text-[#89859A] underline transition hover:text-purple-600"
                >
                  Şifrəni dəyiş
                </button>
                <button
                  onClick={handleSignOut}
                  className="text-[#89859A] underline transition hover:text-red-500"
                >
                  Çıxış et
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 3. STATİSTİKA */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ['Öyrətdiyim saatlar', `${stats.teachingHours} saat`],
            ['Öyrəndiyim saatlar', `${stats.learningHours} saat`],
            ['Tamamlanan seanslar', `${stats.completedSessions}`],
            ['Kredit balansı', `${profile?.credit_balance ?? 0} kredit`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-[#F1ECFF] bg-white p-5 shadow-sm"
            >
              <p className="text-sm text-[#89859A]">{label}</p>
              <h3 className="mt-2 text-2xl font-bold text-purple-600">
                {value}
              </h3>
            </div>
          ))}
        </section>

        {/* 4. BACARIQLARIM */}
        <section className="rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold">
            Bacarıqlarım
          </h2>

          <div className="mb-5 flex flex-wrap gap-3">
            {([
              ['teach', `Öyrətdiklərim (${teachSkills.length})`],
              ['learn', `Öyrəndiklərim (${learnSkills.length})`],
            ] as [SkillType, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
                  activeTab === tab
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tabSkills.length === 0 ? (
            <div className="rounded-xl bg-[#faf9fd] px-6 py-8 text-center">
              <p className="text-sm text-[#89859A]">
                {activeTab === 'teach'
                  ? 'Hələ paylaşdığın bacarıq yoxdur. "+ Bacarıq əlavə et" düyməsi ilə bildiyin mövzuları əlavə et — digər istifadəçilər səndən dərs ala bilsin.'
                  : 'Öyrənmək istədiyin mövzu yoxdur. "+ Bacarıq əlavə et" düyməsi ilə hədəflərini əlavə et — uyğun müəllimləri tapmaq asanlaşsın.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tabSkills.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-[#faf9fd] p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {item.skills?.name ?? 'Bacarıq'}
                      </h3>
                      {item.skills?.category && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            item.type === 'teach'
                              ? 'bg-purple-50 text-purple-600'
                              : 'bg-[#FCE7F3] text-pink-700'
                          }`}
                        >
                          {item.skills.category}
                        </span>
                      )}
                    </div>

                    {item.level ? (
                      <p className="mt-0.5 text-xs font-medium text-purple-500">
                        Səviyyə: {LEVEL_LABELS[item.level] ?? item.level}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-[#89859A]">
                        Səviyyə təyin edilməyib
                      </p>
                    )}

                    {item.description && (
                      <p className="mt-1 text-sm text-[#89859A]">
                        {item.description}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => openEditSkillModal(item)}
                      disabled={busySkillId !== null}
                      aria-label="Redaktə et"
                      title="Redaktə et"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-100 text-purple-500 transition hover:bg-purple-50 disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9" strokeLinecap="round" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteSkill(item.id)}
                      disabled={busySkillId !== null}
                      aria-label="Sil"
                      title="Sil"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-100 text-red-500 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18" strokeLinecap="round" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => openAddModal(activeTab)}
            className="mt-5 font-semibold text-purple-600 transition hover:text-purple-700"
          >
            + Bacarıq əlavə et
          </button>
        </section>

        {/* 5. SON RƏYLƏR */}
        <section className="rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold">Son rəylər</h2>

          {!reviewsAvailable ? (
            <div className="rounded-xl bg-[#faf9fd] p-4 text-center text-sm text-[#89859A]">
              Rəylər bölməsi üçün bazada "reviews" cədvəli hələ yaradılmayıb.
              Repodakı{' '}
              <code className="rounded bg-[#F1ECFF] px-1 text-purple-700">
                src/database/03_reviews.sql
              </code>{' '}
              faylını Supabase SQL redaktorunda işlətsən, tamamlanan
              seanslardan sonra şagirdlərin rəyləri burada görünəcək.
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="rounded-xl bg-[#faf9fd] p-4 text-center text-sm text-[#89859A]">
              Hələ rəy yoxdur. Tamamlanan seanslardan sonra şagirdlər burada
              rəy yaza bilər.
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="rounded-xl bg-[#faf9fd] p-4">
                  <div className="flex items-center gap-3">
                    {review.reviewer?.avatar_url ? (
                      <img
                        src={review.reviewer.avatar_url}
                        alt={review.reviewer.full_name || 'İstifadəçi'}
                        className="h-9 w-9 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-200 to-pink-200 text-xs font-bold text-purple-700">
                        {initialsOf(review.reviewer?.full_name || 'İ')}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {review.reviewer?.full_name || 'İstifadəçi'}
                        </span>
                        <span className="text-sm text-yellow-500">
                          {'★'.repeat(review.rating)}
                          <span className="text-gray-300">
                            {'★'.repeat(5 - review.rating)}
                          </span>
                        </span>
                      </div>
                      <span className="text-[10px] text-[#89859A]">
                        {formatDate(review.created_at)}
                      </span>
                    </div>
                  </div>

                  {review.comment && (
                    <p className="mt-2 text-sm text-[#89859A]">
                      {review.comment}
                    </p>
                  )}

                  {review.skill?.name && (
                    <span className="mt-2 inline-block rounded-full bg-[#FCE7F3] px-2.5 py-1 text-[10px] font-semibold text-pink-700">
                      Seans: {review.skill.name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      {/* EDIT PROFILE MODAL */}
      {profileModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#29243A]/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => !profileSaving && setProfileModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-2xl"
          >
            <h2
              id="edit-profile-title"
              className="text-xl font-bold text-[#29243A]"
            >
              Profili redaktə et
            </h2>

            <form onSubmit={handleSaveProfile} className="mt-4 space-y-4">
              <div>
                <label htmlFor="pf-name" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Ad və soyad
                </label>
                <input
                  id="pf-name"
                  type="text"
                  value={editFullName}
                  onChange={e => setEditFullName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label htmlFor="pf-bio" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Haqqımda
                </label>
                <textarea
                  id="pf-bio"
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  rows={3}
                  maxLength={400}
                  placeholder="Nə öyrədirsən, nə təcrübən var?"
                  className="w-full resize-none rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label htmlFor="pf-avatar" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Profil şəkli linki (istəyə bağlı)
                </label>
                <input
                  id="pf-avatar"
                  type="url"
                  value={editAvatarUrl}
                  onChange={e => setEditAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label htmlFor="pf-uni" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Universitet / iş yeri (istəyə bağlı)
                </label>
                <input
                  id="pf-uni"
                  type="text"
                  value={editUniversity}
                  onChange={e => setEditUniversity(e.target.value)}
                  className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              {profileError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                  {profileError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setProfileModal(false)}
                  disabled={profileSaving}
                  className="flex-1 rounded-xl bg-purple-100 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-200 disabled:opacity-60"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                >
                  {profileSaving ? 'Yadda saxlanır...' : 'Yadda saxla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT SKILL MODAL */}
      {editSkill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#29243A]/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => !skillSaving && closeAllSkillModals()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-skill-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-2xl"
          >
            <h2
              id="edit-skill-title"
              className="text-xl font-bold text-[#29243A]"
            >
              Bacarığı redaktə et: {editSkill.skills?.name}
            </h2>

            <form onSubmit={handleSaveSkill} className="mt-4 space-y-4">
              <div>
                <label htmlFor="es-level" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Səviyyə
                </label>
                <select
                  id="es-level"
                  value={editLevel}
                  onChange={e => setEditLevel(e.target.value)}
                  className="w-full rounded-xl border border-purple-100 bg-white px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                >
                  <option value="beginner">Başlanğıc</option>
                  <option value="intermediate">Orta səviyyə</option>
                  <option value="advanced">İnkişaf etmiş</option>
                </select>
              </div>

              <div>
                <label htmlFor="es-desc" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Təsvir
                </label>
                <textarea
                  id="es-desc"
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder={
                    editSkill.type === 'teach'
                      ? 'Nələri öyrədirsən? Müddət və format haqqında qeyd...'
                      : 'Nə öyrənmək istəyirsən? Hədəfin haqqında qeyd...'
                  }
                  className="w-full resize-none rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
                <p className="mt-1 text-right text-[10px] text-[#89859A]">
                  Məsələn: Müddət: 1-2 saat · Onlayn
                </p>
              </div>

              {skillError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                  {skillError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeAllSkillModals}
                  disabled={skillSaving}
                  className="flex-1 rounded-xl bg-purple-100 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-200 disabled:opacity-60"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={skillSaving}
                  className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                >
                  {skillSaving ? 'Yadda saxlanır...' : 'Yadda saxla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD SKILL MODAL */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#29243A]/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => !addSaving && closeAllSkillModals()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-skill-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-2xl"
          >
            <h2
              id="add-skill-title"
              className="text-xl font-bold text-[#29243A]"
            >
              + Bacarıq əlavə et
            </h2>

            <p className="mt-1 text-xs text-[#89859A]">
              Mövzunu seç — öyrətdiyin və ya öyrənmək istədiyin bacarığı əlavə et.
            </p>

            <form onSubmit={handleAddSkill} className="mt-4 space-y-4">
              <div>
                <label htmlFor="as-type" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Növ
                </label>
                <select
                  id="as-type"
                  value={addType}
                  onChange={e => setAddType(e.target.value as SkillType)}
                  className="w-full rounded-xl border border-purple-100 bg-white px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                >
                  <option value="teach">Öyrədirəm — digərlərinə dərs verirəm</option>
                  <option value="learn">Öyrənirəm — öyrənmək istəyirəm</option>
                </select>
              </div>

              <div>
                <label htmlFor="as-skill" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Bacarıq
                </label>
                <select
                  id="as-skill"
                  value={addSkillId}
                  onChange={e => setAddSkillId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-purple-100 bg-white px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                >
                  <option value="">Bacarıq seç</option>
                  {catalog.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.category})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="as-level" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Səviyyən
                </label>
                <select
                  id="as-level"
                  value={addLevel}
                  onChange={e => setAddLevel(e.target.value)}
                  className="w-full rounded-xl border border-purple-100 bg-white px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                >
                  <option value="beginner">Başlanğıc</option>
                  <option value="intermediate">Orta səviyyə</option>
                  <option value="advanced">İnkişaf etmiş</option>
                </select>
              </div>

              <div>
                <label htmlFor="as-desc" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Təsvir (istəyə bağlı)
                </label>
                <textarea
                  id="as-desc"
                  value={addDescription}
                  onChange={e => setAddDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Məsələn: Müddət: 1-2 saat · Onlayn"
                  className="w-full resize-none rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              {addError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                  {addError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeAllSkillModals}
                  disabled={addSaving}
                  className="flex-1 rounded-xl bg-purple-100 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-200 disabled:opacity-60"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={addSaving || !addSkillId}
                  className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                >
                  {addSaving ? 'Əlavə olunur...' : 'Əlavə et'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CHANGE PASSWORD MODAL */}
      {pwdModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#29243A]/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => !pwdSaving && setPwdModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwd-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-2xl"
          >
            <h2
              id="pwd-title"
              className="text-xl font-bold text-[#29243A]"
            >
              Şifrəni dəyiş
            </h2>

            <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
              <div>
                <label htmlFor="pwd-new" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Yeni şifrə
                </label>
                <input
                  id="pwd-new"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                  className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label htmlFor="pwd-confirm" className="mb-1 block text-xs font-semibold text-[#29243A]">
                  Yeni şifrə (təkrar)
                </label>
                <input
                  id="pwd-confirm"
                  type="password"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                />
              </div>

              {pwdError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                  {pwdError}
                </div>
              )}

              {pwdSuccess && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-700">
                  {pwdSuccess}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setPwdModal(false)}
                  disabled={pwdSaving}
                  className="flex-1 rounded-xl bg-purple-100 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-200 disabled:opacity-60"
                >
                  {pwdSuccess ? 'Bağla' : 'Ləğv et'}
                </button>
                {!pwdSuccess && (
                  <button
                    type="submit"
                    disabled={pwdSaving}
                    className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                  >
                    {pwdSaving ? 'Dəyişdirilir...' : 'Dəyişdir'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Profile
