
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

type ProfileRow = {
  full_name: string
  bio: string | null
  avatar_url: string | null
  university: string | null
  credit_balance: number
}

type MySkill = {
  id: number
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

function fetchMyTeachSkills(userId: string) {
  return supabase
    .from('user_skills')
    .select('id, level, description, skills(id, name, category)')
    .eq('user_id', userId)
    .eq('type', 'teach')
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
  const [stats, setStats] = useState({ earned: 0, spent: 0 })
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null)
  const [reviewsAvailable, setReviewsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

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
  // effect lazım deyil: modalın açıqlığı URL-dən törəmiş (derived) halda hesablanır
  const addParam = searchParams.get('add') === '1'
  const addModalOpen = addModal || addParam
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

    const { data, error } = await fetchMyTeachSkills(user.id)

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
        const [profileRes, skillsRes, statsRes, reviewsRes] = await Promise.all([
          fetchProfile(userId),
          fetchMyTeachSkills(userId),
          fetchCreditStats(userId),
          fetchMyReviews(userId),
        ])

        if (ignore) return

        if (profileRes.error) throw profileRes.error

        setProfile(profileRes.data as unknown as ProfileRow)
        setMySkills(((skillsRes.data ?? []) as unknown) as MySkill[])

        const transactions = statsRes.data ?? []
        const earned = transactions
          .filter(item => item.type === 'lesson_earned')
          .reduce((sum, item) => sum + item.amount, 0)
        const spent = transactions
          .filter(item => item.type === 'lesson_spent')
          .reduce((sum, item) => sum + Math.abs(item.amount), 0)
        setStats({ earned, spent })

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

  // Bacarıq katalogu yalnız modal açılanda yüklənir
  async function openAddModal() {
    setAddModal(true)
    setAddError('')
    setAddSkillId('')
    setAddLevel('beginner')
    setAddDescription('')

    const { data, error } = await fetchSkillCatalog()

    if (error) {
      setAddError(error.message)
      return
    }

    setCatalog((data ?? []) as unknown as SkillCatalogItem[])
  }

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
        type: 'teach',
        level: addLevel,
        description: addDescription.trim() || null,
      })

      if (error) {
        setAddError(error.message)
        return
      }

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

  const tagLine = useMemo(
    () =>
      Array.from(
        new Set(
          mySkills
            .map(item => item.skills?.category)
            .filter((category): category is string => Boolean(category))
        )
      ).join(' / '),
    [mySkills]
  )

  const rating = useMemo(() => {
    if (!reviews || reviews.length === 0) return null

    const avg =
      reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length

    return avg.toFixed(1)
  }, [reviews])

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-sm text-[#8065a8]">
        Profil yüklənir...
      </div>
    )
  }

  if (pageError && !profile) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-sm text-red-600">
        <p>{pageError}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-[#8b20d5] px-5 py-2 text-white"
        >
          Yenidən cəhd et
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-3xl bg-[#f7f2fd] px-4 py-8 sm:px-8">

      {/* PAGE HEADER */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#24105c] sm:text-3xl">
          Mənim profil
        </h1>
        <p className="mt-1 text-xs text-[#8065a8] sm:text-sm">
          Hesab məlumatlarını və bacarıqlarımı buradan idarə et.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px,1fr]">

        {/* LEFT CARD */}
        <section className="h-fit rounded-2xl border border-[#ecd1f6] bg-white p-6 text-center">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.full_name || 'İstifadəçi'}
              className="mx-auto h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#f4e1fb] text-2xl font-bold text-[#8b20d5]">
              {initials}
            </div>
          )}

          <h2 className="mt-4 text-lg font-bold text-[#24105c]">
            {profile?.full_name || 'İstifadəçi'}
          </h2>

          {tagLine && (
            <span className="mt-2 inline-block rounded-full bg-[#f4e1fb] px-3 py-1 text-[10px] font-semibold text-[#8b20d5]">
              {tagLine}
            </span>
          )}

          {profile?.bio && (
            <p className="mt-3 text-xs leading-5 text-[#604c85]">
              {profile.bio}
            </p>
          )}

          {profile?.university && (
            <p className="mt-1 text-[10px] text-[#a58ab9]">
              {profile.university}
            </p>
          )}

          <p className="mt-3 text-xs font-semibold text-[#24105c]">
            {rating ? (
              <>★ {rating} ({reviews?.length} rəy)</>
            ) : (
              <span className="text-[#a58ab9]">Hələ rəy yoxdur</span>
            )}
          </p>

          {/* STATS */}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[#faf4fd] py-3">
              <p className="text-lg font-bold text-[#24105c]">{stats.earned} saat</p>
              <p className="text-[10px] text-[#8065a8]">Öyrətdiyi</p>
            </div>
            <div className="rounded-xl bg-[#faf4fd] py-3">
              <p className="text-lg font-bold text-[#24105c]">{stats.spent} saat</p>
              <p className="text-[10px] text-[#8065a8]">Öyrəndiyi</p>
            </div>
          </div>

          {/* BALANCE */}
          <div className="mt-4 rounded-xl border border-green-200 bg-[#dcfce7] px-4 py-4">
            <p className="text-[10px] text-[#3f6212]">Cari balans</p>
            <p className="mt-1 text-2xl font-bold text-[#166534]">
              {profile?.credit_balance ?? 0} saat
            </p>
            <Link
              to="/credits"
              className="mt-1 inline-block text-[10px] font-semibold text-[#3f6212] underline"
            >
              Pulqabıya bax →
            </Link>
          </div>

          <button
            onClick={openEditProfileModal}
            className="mt-5 w-full rounded-xl border-2 border-[#c86ee8] py-2.5 text-sm font-semibold text-[#8b20d5] transition hover:bg-[#faf0fd]"
          >
            Profili redaktə et
          </button>

          <div className="mt-4 flex items-center justify-center gap-5 text-xs">
            <button
              onClick={() => setPwdModal(true)}
              className="text-[#604c85] underline hover:text-[#8b20d5]"
            >
              Şifrəni dəyiş
            </button>
            <button
              onClick={handleSignOut}
              className="text-[#604c85] underline hover:text-red-600"
            >
              Çıxış et
            </button>
          </div>
        </section>

        {/* RIGHT SIDE */}
        <section>

          {/* SKILLS HEADER */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#24105c]">
              Mənim bacarıqlarım: {mySkills.length}
            </h2>
            <button
              onClick={openAddModal}
              className="rounded-lg bg-[#8b20d5] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#7415c2]"
            >
              + Bacarıq əlavə et
            </button>
          </div>

          {pageError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-600">
              {pageError}
            </div>
          )}

          {/* SKILL CARDS */}
          {mySkills.length === 0 ? (
            <div className="rounded-2xl border border-[#ecd1f6] bg-white px-6 py-10 text-center">
              <p className="text-sm text-[#8065a8]">
                Hələ paylaşdığın bacarıq yoxdur. "+ Bacarıq əlavə et" düyməsi ilə
                bildiyin mövzuları əlavə et — digər istifadəçilər səndən dərs ala bilsin.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {mySkills.map(item => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-[#ecd1f6] bg-white px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.skills?.category && (
                          <span className="rounded-full bg-[#f4e1fb] px-2.5 py-1 text-[10px] font-semibold text-[#8b20d5]">
                            {item.skills.category}
                          </span>
                        )}
                        <span className="flex items-center gap-1 rounded-full bg-[#dcfce7] px-2.5 py-1 text-[10px] font-semibold text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Aktiv
                        </span>
                      </div>

                      <h3 className="mt-2 text-sm font-bold text-[#24105c]">
                        {item.skills?.name ?? 'Bacarıq'}
                      </h3>

                      <p className="mt-1 text-[11px] text-[#8065a8]">
                        {item.description
                          ? item.description
                          : item.level
                            ? `Səviyyə: ${LEVEL_LABELS[item.level] ?? item.level}`
                            : 'Təsvir əlavə edilməyib'}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => openEditSkillModal(item)}
                        disabled={busySkillId !== null}
                        aria-label="Redaktə et"
                        title="Redaktə et"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#ecd1f6] text-[#8b20d5] transition hover:bg-[#faf0fd] disabled:opacity-50"
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
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#ecd1f6] text-red-500 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18" strokeLinecap="round" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* REVIEWS */}
          <div className="mb-4 mt-10 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <h2 className="text-lg font-bold text-[#24105c]">Son rəylər</h2>
            {reviewsAvailable && reviews && reviews.length > 0 && (
              <Link
                to="/credits"
                className="text-xs font-semibold text-[#8b20d5] underline"
              >
                Hamısına bax
              </Link>
            )}
          </div>

          {!reviewsAvailable ? (
            <div className="rounded-2xl border border-[#ecd1f6] bg-white px-6 py-8 text-center">
              <p className="text-sm text-[#8065a8]">
                Rəylər bölməsi üçün bazada "reviews" cədvəli hələ yaradılmayıb.
                repodakı <code className="rounded bg-[#faf4fd] px-1">src/database/03_reviews.sql</code> faylını
                Supabase SQL redaktorunda işlətsən, burada alan şagirdlərin rəyləri görünəcək.
              </p>
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="rounded-2xl border border-[#ecd1f6] bg-white px-6 py-8 text-center">
              <p className="text-sm text-[#8065a8]">
                Hələ rəy yoxdur. Tamamlanan seanslardan sonra şagirdlər burada rəy yaza bilər.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map(review => (
                <article
                  key={review.id}
                  className="rounded-2xl border border-[#ecd1f6] bg-white px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f4e1fb] text-xs font-bold text-[#8b20d5]">
                      {initialsOf(review.reviewer?.full_name || 'İ')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[#24105c]">
                          {review.reviewer?.full_name || 'İstifadəçi'}
                        </span>
                        <span className="text-[10px] text-[#a58ab9]">
                          {formatDate(review.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-[#f59e0b]">
                        {'★'.repeat(review.rating)}
                        <span className="text-[#d8c7e8]">
                          {'★'.repeat(5 - review.rating)}
                        </span>
                      </p>
                    </div>
                  </div>

                  {review.comment && (
                    <p className="mt-3 text-xs leading-5 text-[#3b3155]">
                      {review.comment}
                    </p>
                  )}

                  {review.skill?.name && (
                    <span className="mt-3 inline-block rounded-full bg-[#f4e1fb] px-2.5 py-1 text-[10px] font-semibold text-[#8b20d5]">
                      Seans: {review.skill.name}
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* EDIT PROFILE MODAL */}
      {profileModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#24105c]/50 px-4 py-6 backdrop-blur-sm"
          onClick={() => !profileSaving && setProfileModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-2xl border border-[#eac8f5] bg-white p-6 shadow-2xl"
          >
            <h2
              id="edit-profile-title"
              className="text-lg font-bold text-[#24105c]"
            >
              Profili redaktə et
            </h2>

            <form onSubmit={handleSaveProfile} className="mt-4 space-y-4">
              <div>
                <label htmlFor="pf-name" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Ad və soyad
                </label>
                <input
                  id="pf-name"
                  type="text"
                  value={editFullName}
                  onChange={e => setEditFullName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                />
              </div>

              <div>
                <label htmlFor="pf-bio" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Haqqımda
                </label>
                <textarea
                  id="pf-bio"
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  rows={3}
                  maxLength={400}
                  placeholder="Nə öyrədirsən, nə təcrübən var?"
                  className="w-full resize-none rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                />
              </div>

              <div>
                <label htmlFor="pf-avatar" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Avatar şəkil linki (istəyə bağlı)
                </label>
                <input
                  id="pf-avatar"
                  type="url"
                  value={editAvatarUrl}
                  onChange={e => setEditAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                />
              </div>

              <div>
                <label htmlFor="pf-uni" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Universitet / iş yeri (istəyə bağlı)
                </label>
                <input
                  id="pf-uni"
                  type="text"
                  value={editUniversity}
                  onChange={e => setEditUniversity(e.target.value)}
                  className="w-full rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
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
                  className="flex-1 rounded-xl border border-[#e8b9f7] py-2.5 text-sm font-semibold text-[#604c85] transition hover:bg-[#faf4fd]"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="flex-1 rounded-xl bg-[#861bd2] py-2.5 text-sm font-semibold text-white transition hover:bg-[#7015b5] disabled:opacity-60"
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
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#24105c]/50 px-4 py-6 backdrop-blur-sm"
          onClick={() => !skillSaving && closeAllSkillModals()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-skill-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-2xl border border-[#eac8f5] bg-white p-6 shadow-2xl"
          >
            <h2
              id="edit-skill-title"
              className="text-lg font-bold text-[#24105c]"
            >
              Bacarığı redaktə et: {editSkill.skills?.name}
            </h2>

            <form onSubmit={handleSaveSkill} className="mt-4 space-y-4">
              <div>
                <label htmlFor="es-level" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Səviyyə
                </label>
                <select
                  id="es-level"
                  value={editLevel}
                  onChange={e => setEditLevel(e.target.value)}
                  className="w-full rounded-xl border border-[#e8b9f7] bg-white px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                >
                  <option value="beginner">Başlanğıc</option>
                  <option value="intermediate">Orta səviyyə</option>
                  <option value="advanced">İnkişaf etmiş</option>
                </select>
              </div>

              <div>
                <label htmlFor="es-desc" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Təsvir
                </label>
                <textarea
                  id="es-desc"
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Nələri öyrədirsən? Müddət və format haqqında qeyd..."
                  className="w-full resize-none rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                />
                <p className="mt-1 text-right text-[10px] text-[#a58ab9]">
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
                  className="flex-1 rounded-xl border border-[#e8b9f7] py-2.5 text-sm font-semibold text-[#604c85] transition hover:bg-[#faf4fd]"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={skillSaving}
                  className="flex-1 rounded-xl bg-[#861bd2] py-2.5 text-sm font-semibold text-white transition hover:bg-[#7015b5] disabled:opacity-60"
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
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#24105c]/50 px-4 py-6 backdrop-blur-sm"
          onClick={() => !addSaving && closeAllSkillModals()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-skill-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-2xl border border-[#eac8f5] bg-white p-6 shadow-2xl"
          >
            <h2
              id="add-skill-title"
              className="text-lg font-bold text-[#24105c]"
            >
              + Bacarıq əlavə et
            </h2>

            <p className="mt-1 text-xs text-[#8065a8]">
              Bildiyin mövzunu seç — digər istifadəçilər səndən dərs ala bilsin.
            </p>

            <form onSubmit={handleAddSkill} className="mt-4 space-y-4">
              <div>
                <label htmlFor="as-skill" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Bacarıq
                </label>
                <select
                  id="as-skill"
                  value={addSkillId}
                  onChange={e => setAddSkillId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#e8b9f7] bg-white px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
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
                <label htmlFor="as-level" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Səviyyən
                </label>
                <select
                  id="as-level"
                  value={addLevel}
                  onChange={e => setAddLevel(e.target.value)}
                  className="w-full rounded-xl border border-[#e8b9f7] bg-white px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                >
                  <option value="beginner">Başlanğıc</option>
                  <option value="intermediate">Orta səviyyə</option>
                  <option value="advanced">İnkişaf etmiş</option>
                </select>
              </div>

              <div>
                <label htmlFor="as-desc" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Təsvir (istəyə bağlı)
                </label>
                <textarea
                  id="as-desc"
                  value={addDescription}
                  onChange={e => setAddDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Məsələn: Müddət: 1-2 saat · Onlayn"
                  className="w-full resize-none rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
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
                  className="flex-1 rounded-xl border border-[#e8b9f7] py-2.5 text-sm font-semibold text-[#604c85] transition hover:bg-[#faf4fd]"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={addSaving || !addSkillId}
                  className="flex-1 rounded-xl bg-[#861bd2] py-2.5 text-sm font-semibold text-white transition hover:bg-[#7015b5] disabled:opacity-60"
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
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#24105c]/50 px-4 py-6 backdrop-blur-sm"
          onClick={() => !pwdSaving && setPwdModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwd-title"
            onClick={e => e.stopPropagation()}
            className="relative my-auto w-full max-w-md rounded-2xl border border-[#eac8f5] bg-white p-6 shadow-2xl"
          >
            <h2
              id="pwd-title"
              className="text-lg font-bold text-[#24105c]"
            >
              Şifrəni dəyiş
            </h2>

            <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
              <div>
                <label htmlFor="pwd-new" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Yeni şifrə
                </label>
                <input
                  id="pwd-new"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                  className="w-full rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
                />
              </div>

              <div>
                <label htmlFor="pwd-confirm" className="mb-1 block text-xs font-semibold text-[#291078]">
                  Yeni şifrə (təkrar)
                </label>
                <input
                  id="pwd-confirm"
                  type="password"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#e8b9f7] px-3 py-2.5 text-sm text-[#291078] outline-none focus:border-[#8b20d5]"
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
                  className="flex-1 rounded-xl border border-[#e8b9f7] py-2.5 text-sm font-semibold text-[#604c85] transition hover:bg-[#faf4fd]"
                >
                  {pwdSuccess ? 'Bağla' : 'Ləğv et'}
                </button>
                {!pwdSuccess && (
                  <button
                    type="submit"
                    disabled={pwdSaving}
                    className="flex-1 rounded-xl bg-[#861bd2] py-2.5 text-sm font-semibold text-white transition hover:bg-[#7015b5] disabled:opacity-60"
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
