
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from 'react-i18next'
import { authErrorKey } from '../lib/authErrors'
import { fileToAvatarDataUrl } from '../lib/avatarImage'
import SkillModals, {
  type SkillData,
  type SkillProposal,
} from '../components/SkillModals'

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

const REVIEWS_SQL_FILE = 'src/database/03_reviews.sql'

// Dil kodu → toLocaleString locale kodu
const DATE_LOCALES: Record<string, string> = {
  az: 'az-AZ',
  en: 'en-GB',
  ru: 'ru-RU',
  tr: 'tr-TR',
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

// Səviyyənin DB dəyərini i18n açarına çevirir (beginner → profile.levelBeginner)
function levelKey(level: string) {
  if (level === 'beginner') return 'profile.levelBeginner'
  if (level === 'intermediate') return 'profile.levelIntermediate'
  if (level === 'advanced') return 'profile.levelAdvanced'
  return null
}

function Profile() {
  const { user, signOut, updatePassword } = useAuth()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const dateLocale = DATE_LOCALES[i18n.resolvedLanguage ?? 'az'] ?? 'az-AZ'

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

  // Profil şəkli yükləmə (qalereya / kamera)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')

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
  // SkillModals-ın başlanğıc rejimi — profilin aktiv tab-ı ilə açılır
  const [addType, setAddType] = useState<SkillType>('teach')

  const [pwdModal, setPwdModal] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
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
          err instanceof Error ? err.message : t('profile.loadFailed')
        )
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void loadAll()

    return () => {
      ignore = true
    }
  }, [user, t])

  // Bacarıq katalogu modal açılanda (düymədən VƏ YA ?add=1 linkindən) yüklənsin
  useEffect(() => {
    if (!addModalOpen || catalog.length > 0) return

    let ignore = false

    fetchSkillCatalog().then(({ data, error }) => {
      if (ignore) return

      if (error) {
        setPageError(error.message)
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
    setAvatarError('')
    setProfileModal(true)
  }

  // Qalereya / kamera seçilmiş faylı emal edir və data URL yaratdıqdan
  // sonra redaktə formasına qoyur — save düyməsi basılanda bazaya yazılır
  async function handleAvatarFile(file: File | undefined | null) {
    if (!file) return

    setAvatarBusy(true)
    setAvatarError('')

    const result = await fileToAvatarDataUrl(file)

    if (result.ok) {
      setEditAvatarUrl(result.dataUrl)
    } else if (result.reason === 'invalid') {
      setAvatarError(t('profile.avatar.invalidFile'))
    } else if (result.reason === 'tooLarge') {
      setAvatarError(t('profile.avatar.tooLarge'))
    } else {
      setAvatarError(t('profile.avatar.processingError'))
    }

    // Eyni faylı yenidən seçəndə onChange baş işləsin
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''

    setAvatarBusy(false)
  }

  function openEditSkillModal(skill: MySkill) {
    setEditSkill(skill)
    setEditLevel(skill.level ?? 'beginner')
    setEditDescription(skill.description ?? '')
    setSkillError('')
  }

  function openAddModal(type: SkillType) {
    setAddType(type)
    setAddModal(true)
  }

  function closeAllSkillModals() {
    setEditSkill(null)
    setAddModal(false)
    setSkillError('')

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
        err instanceof Error ? err.message : t('profile.unexpected')
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
        err instanceof Error ? err.message : t('profile.unexpected')
      )
    } finally {
      setSkillSaving(false)
    }
  }

  // SkillModals-dan gələn məlumatı user_skills-ə yazır.
  // Uğur → modal özü bağlanır (SkillData resolve); xəta → modal göstərir
  async function handleAddSkill(data: SkillData) {
    if (!user) throw new Error(t('errors.generic'))

    const base = {
      user_id: user.id,
      skill_id: data.skillId,
      type: data.mode,
      level: data.level,
      description: data.description.trim() || null,
    }

    // experience sütunu 18_skill_proposals.sql ilə əlavə olundu;
    // hələ tətbiq olunmamış bazada xəta yaransın, o halda sütunsuz yoxlanır
    const { error } = await supabase
      .from('user_skills')
      .insert({ ...base, experience: data.experience })

    if (error) {
      if (error.message.includes('experience')) {
        const retry = await supabase.from('user_skills').insert(base)

        if (retry.error) {
          throw new Error(retry.error.message)
        }
      } else {
        throw new Error(error.message)
      }
    }

    setActiveTab(data.mode)
    setAddModal(false)

    if (addParam) {
      setSearchParams({}, { replace: true })
    }

    await reloadSkills()
  }

  // Siyahıda olmayan bacarıq üçün admin təsdiqinə təklif göndərir
  // (skill_proposals cədvəli — 18_skill_proposals.sql, RLS: yalnız öz adına)
  async function handleProposeSkill(data: SkillProposal) {
    if (!user) throw new Error(t('errors.generic'))

    const { error } = await supabase.from('skill_proposals').insert({
      proposed_by: user.id,
      name: data.name,
      category: data.category,
      description: data.description.trim() || null,
    })

    if (error) {
      throw new Error(error.message)
    }
  }

  async function handleDeleteSkill(skillId: number) {
    if (busySkillId !== null) return

    const confirmed = window.confirm(t('profile.confirmDeleteSkill'))

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
        err instanceof Error ? err.message : t('profile.unexpected')
      )
    } finally {
      setBusySkillId(null)
    }
  }

  // Şifrə dəyişmə: əvvəlcə köhnə şifrə yenidən girişlə yoxlanılır,
  // uğurlu olduqdan sonra updateUser yeni şifrəni tətbiq edir
  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!user?.email) {
      setPwdError(t('errors.generic'))
      return
    }

    if (newPassword !== confirmNewPassword) {
      setPwdError(t('profile.pwdMismatch'))
      return
    }

    if (newPassword.length < 6) {
      setPwdError(t('profile.pwdShort'))
      return
    }

    setPwdSaving(true)
    setPwdError('')
    setPwdSuccess('')

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPassword,
      })

      if (verifyError) {
        setPwdError(
          verifyError.code === 'invalid_credentials' ||
            verifyError.message.toLowerCase().includes('invalid login')
            ? t('profile.pwdWrongOld')
            : t(authErrorKey(verifyError))
        )
        return
      }

      const { error } = await updatePassword(newPassword)

      if (error) {
        setPwdError(t(authErrorKey(error)))
        return
      }

      setPwdSuccess(t('profile.pwdChanged'))
      setOldPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (err: unknown) {
      setPwdError(
        err instanceof Error ? err.message : t('profile.unexpected')
      )
    } finally {
      setPwdSaving(false)
    }
  }

  function openPwdModal() {
    setOldPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
    setPwdError('')
    setPwdSuccess('')
    setPwdModal(true)
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
        <p className="text-sm text-[#89859A]">{t('profile.loading')}</p>
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
            {t('common.tryAgain')}
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
            OF COURSE / {t('nav.profile').toUpperCase()}
          </p>
          <h1 className="mt-2 text-3xl font-bold">
            {t('profile.title')}
          </h1>
          <p className="mt-1 text-[#89859A]">
            {t('profile.subtitle')}
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
                alt={profile.full_name || t('profile.user')}
                className="h-24 w-24 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-200 to-pink-200 text-2xl font-bold text-purple-700">
                {initials}
              </div>
            )}

            <div className="min-w-0 flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold">
                {profile?.full_name || t('profile.user')}
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
                  <>★★★★★ {rating} · {t('profile.reviewsCount', { count: reviews?.length ?? 0 })}</>
                ) : (
                  <span className="text-[#89859A]">{t('profile.noReviewsYet')}</span>
                )}
              </p>
            </div>

            <div className="flex flex-col items-center gap-2 md:items-end">
              <button
                onClick={openEditProfileModal}
                className="rounded-xl bg-purple-100 px-5 py-3 font-semibold text-purple-700 transition hover:bg-purple-200"
              >
                {t('profile.editProfile')}
              </button>
              <div className="flex items-center gap-4 text-xs">
                <button
                  onClick={openPwdModal}
                  className="text-[#89859A] underline transition hover:text-purple-600"
                >
                  {t('profile.changePassword')}
                </button>
                <button
                  onClick={handleSignOut}
                  className="text-[#89859A] underline transition hover:text-red-500"
                >
                  {t('profile.signOut')}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 3. STATİSTİKA */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            [t('profile.statTeachingHours'), `${stats.teachingHours} ${t('common.hours')}`],
            [t('profile.statLearningHours'), `${stats.learningHours} ${t('common.hours')}`],
            [t('profile.statSessions'), `${stats.completedSessions}`],
            [t('profile.statCredits'), `${profile?.credit_balance ?? 0} ${t('common.credits')}`],
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
            {t('profile.mySkills')}
          </h2>

          <div className="mb-5 flex flex-wrap gap-3">
            {([
              ['teach', `${t('profile.tabTeach')} (${teachSkills.length})`],
              ['learn', `${t('profile.tabLearn')} (${learnSkills.length})`],
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
                  ? t('profile.emptyTeach')
                  : t('profile.emptyLearn')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tabSkills.map(item => {
                const level = item.level ? levelKey(item.level) : null

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-[#faf9fd] p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">
                          {item.skills?.name ?? t('profile.skill')}
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
                          {level
                            ? t('profile.levelOf', {
                                level: t(level),
                              })
                            : t('profile.levelOf', { level: item.level })}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-[#89859A]">
                          {t('profile.levelNotSet')}
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
                        aria-label={t('profile.edit')}
                        title={t('profile.edit')}
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
                        aria-label={t('profile.delete')}
                        title={t('profile.delete')}
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
                )
              })}
            </div>
          )}

          <button
            onClick={() => openAddModal(activeTab)}
            className="mt-5 font-semibold text-purple-600 transition hover:text-purple-700"
          >
            {t('profile.addSkill')}
          </button>
        </section>

        {/* 5. SON RƏYLƏR */}
        <section className="rounded-3xl border border-[#F1ECFF] bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold">{t('profile.reviewsTitle')}</h2>

          {!reviewsAvailable ? (
            <div className="rounded-xl bg-[#faf9fd] p-4 text-center text-sm text-[#89859A]">
              {t('profile.reviewsMissing', { file: REVIEWS_SQL_FILE })}
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="rounded-xl bg-[#faf9fd] p-4 text-center text-sm text-[#89859A]">
              {t('profile.reviewsEmpty')}
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="rounded-xl bg-[#faf9fd] p-4">
                  <div className="flex items-center gap-3">
                    {review.reviewer?.avatar_url ? (
                      <img
                        src={review.reviewer.avatar_url}
                        alt={review.reviewer.full_name || t('profile.user')}
                        className="h-9 w-9 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-200 to-pink-200 text-xs font-bold text-purple-700">
                        {initialsOf(review.reviewer?.full_name || 'U')}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {review.reviewer?.full_name || t('profile.user')}
                        </span>
                        <span className="text-sm text-yellow-500">
                          {'★'.repeat(review.rating)}
                          <span className="text-gray-300">
                            {'★'.repeat(5 - review.rating)}
                          </span>
                        </span>
                      </div>
                      <span className="text-[10px] text-[#89859A]">
                        {new Date(review.created_at).toLocaleDateString(
                          dateLocale,
                          {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          }
                        )}
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
                      {t('profile.sessionTag', { name: review.skill.name })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* EDIT PROFILE MODAL */}
        {profileModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#29243A]/45 px-4 py-6 backdrop-blur-sm"
            onClick={() => !profileSaving && !avatarBusy && setProfileModal(false)}
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
                {t('profile.editProfile')}
              </h2>

              <form onSubmit={handleSaveProfile} className="mt-4 space-y-4">
                {/* PROFİL ŞƏKLİ: qalereya / kamera seçimi */}
                <div>
                  <p className="mb-2 block text-xs font-semibold text-[#29243A]">
                    {t('profile.avatar.sectionTitle')}
                  </p>

                  <div className="flex items-center gap-4">
                    {editAvatarUrl ? (
                      <img
                        src={editAvatarUrl}
                        alt={editFullName || t('profile.user')}
                        className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-purple-100"
                      />
                    ) : (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-200 to-pink-200 text-lg font-bold text-purple-700">
                        {initialsOf(editFullName || 'U')}
                      </div>
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          disabled={avatarBusy}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-purple-100 px-3 py-2 text-xs font-semibold text-purple-700 transition hover:bg-purple-200 disabled:opacity-60"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <circle cx="9" cy="11" r="2" />
                            <path d="M21 17l-5-5-6 6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {t('profile.avatar.gallery')}
                        </button>

                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          disabled={avatarBusy}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-pink-50 px-3 py-2 text-xs font-semibold text-pink-700 transition hover:bg-pink-100 disabled:opacity-60"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
                            <circle cx="12" cy="14" r="4" />
                          </svg>
                          {t('profile.avatar.camera')}
                        </button>

                        {editAvatarUrl && (
                          <button
                            type="button"
                            onClick={() => setEditAvatarUrl('')}
                            disabled={avatarBusy}
                            className="inline-flex items-center rounded-xl border border-purple-100 px-3 py-2 text-xs font-semibold text-[#89859A] transition hover:bg-purple-50 disabled:opacity-60"
                          >
                            {t('profile.avatar.remove')}
                          </button>
                        )}
                      </div>

                      {avatarBusy && (
                        <p className="text-xs text-purple-500">
                          {t('profile.avatar.processing')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Mobil cihazlarda "accept" qalereyani, "capture" kamerayı açır */}
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => void handleAvatarFile(e.target.files?.[0])}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={e => void handleAvatarFile(e.target.files?.[0])}
                  />

                  {avatarError && (
                    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                      {avatarError}
                    </div>
                  )}
                </div>

                {/* Xarici link yalnız data URL deyilsə göstərilir (qalereya/kamera seçiləndə boşluq bulanmasın) */}
                {!editAvatarUrl.startsWith('data:') && (
                  <div>
                    <label htmlFor="pf-avatar" className="mb-1 block text-xs font-semibold text-[#29243A]">
                      {t('profile.avatarUrlLabel')}
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
                )}

                <div>
                  <label htmlFor="pf-name" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.fullNameLabel')}
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
                  <label htmlFor="pf-uni" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.universityLabel')}
                  </label>
                  <input
                    id="pf-uni"
                    type="text"
                    value={editUniversity}
                    onChange={e => setEditUniversity(e.target.value)}
                    className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label htmlFor="pf-bio" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.aboutLabel')}
                  </label>
                  <textarea
                    id="pf-bio"
                    value={editBio}
                    onChange={e => setEditBio(e.target.value)}
                    rows={3}
                    maxLength={400}
                    placeholder={t('profile.aboutPlaceholder')}
                    className="w-full resize-none rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
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
                    disabled={profileSaving || avatarBusy}
                    className="flex-1 rounded-xl bg-purple-100 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-200 disabled:opacity-60"
                  >
                    {t('profile.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={profileSaving || avatarBusy}
                    className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                  >
                    {profileSaving ? t('profile.saving') : t('profile.save')}
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
                {t('profile.editSkillTitle', { name: editSkill.skills?.name ?? '' })}
              </h2>

              <form onSubmit={handleSaveSkill} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="es-level" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.levelLabel')}
                  </label>
                  <select
                    id="es-level"
                    value={editLevel}
                    onChange={e => setEditLevel(e.target.value)}
                    className="w-full rounded-xl border border-purple-100 bg-white px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                  >
                    <option value="beginner">{t('profile.levelBeginner')}</option>
                    <option value="intermediate">{t('profile.levelIntermediate')}</option>
                    <option value="advanced">{t('profile.levelAdvanced')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="es-desc" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.descriptionLabel')}
                  </label>
                  <textarea
                    id="es-desc"
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    rows={3}
                    maxLength={300}
                    placeholder={
                      editSkill.type === 'teach'
                        ? t('profile.descPlaceholderTeach')
                        : t('profile.descPlaceholderLearn')
                    }
                    className="w-full resize-none rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                  />
                  <p className="mt-1 text-right text-[10px] text-[#89859A]">
                    {t('profile.descHint')}
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
                    {t('profile.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={skillSaving}
                    className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                  >
                    {skillSaving ? t('profile.saving') : t('profile.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ADD SKILL MODAL — SkillModals komponenti (URL ?add=1 dəstəyi ilə).
            Şərti mount: hər açılışda bütün sahələr təzə başlayır */}
        {addModalOpen && (
          <SkillModals
            open
            onClose={closeAllSkillModals}
            initialMode={addType}
            catalog={catalog}
            onSaveSkill={handleAddSkill}
            onProposeSkill={handleProposeSkill}
          />
        )}

        {/* CHANGE PASSWORD MODAL — köhnə şifrə yoxlaması ilə */}
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
                {t('profile.pwdTitle')}
              </h2>

              <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="pwd-old" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.pwdOldLabel')}
                  </label>
                  <input
                    id="pwd-old"
                    type="password"
                    value={oldPassword}
                    onChange={e => setOldPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label htmlFor="pwd-new" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.pwdNewLabel')}
                  </label>
                  <input
                    id="pwd-new"
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    minLength={6}
                    required
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-purple-100 px-3 py-2.5 text-sm text-[#29243A] outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label htmlFor="pwd-confirm" className="mb-1 block text-xs font-semibold text-[#29243A]">
                    {t('profile.pwdConfirmLabel')}
                  </label>
                  <input
                    id="pwd-confirm"
                    type="password"
                    value={confirmNewPassword}
                    onChange={e => setConfirmNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
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
                    {pwdSuccess ? t('profile.close') : t('profile.cancel')}
                  </button>
                  {!pwdSuccess && (
                    <button
                      type="submit"
                      disabled={pwdSaving}
                      className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
                    >
                      {pwdSaving ? t('profile.pwdChanging') : t('profile.pwdChange')}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Profile
