
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SkillMode = 'teach' | 'learn'

export type SkillCatalogItem = {
  id: number
  name: string
  category: string
}

export type SkillData = {
  mode: SkillMode
  skillId: number
  skill: string
  // DB dəyərləri: beginner | intermediate | advanced
  level: string
  // DB dəyərləri: none | 6m | 1y | 2y | 3y | 4y_plus
  experience: string
  description: string
}

export type SkillProposal = {
  name: string
  category: string
  description: string
}

type Props = {
  /** Uğurla saxlanıldıqda resolve, xətada xəta mesajı ilə reject olunur */
  onSaveSkill: (data: SkillData) => Promise<void> | void
  /** Uğurlu təklifdə resolve, xətada xəta mesajı ilə reject olunur */
  onProposeSkill: (data: SkillProposal) => Promise<void> | void
  /** Supabase `skills` cədvəlindən gələn kataloq (id, name, category) */
  catalog: SkillCatalogItem[]
  /** Nəzarət olunan açılış — verilibsə komponent öz düyməsini göstərmir */
  open?: boolean
  onClose?: () => void
  initialMode?: SkillMode
}

// Səviyyələr — DB `user_skills.level` check-inə uyğun
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const

// Təcrübə — DB `user_skills.experience` check-inə uyğun
const EXPERIENCES = ['none', '6m', '1y', '2y', '3y', '4y_plus'] as const

export default function SkillModals({
  onSaveSkill,
  onProposeSkill,
  catalog,
  open,
  onClose,
  initialMode = 'teach',
}: Props) {
  const { t } = useTranslation()

  // Nəzarət olunan / nəzarət olunmayan rejim.
  // Nəzarət olunan rejimdə komponent parent tərəfindən şərti mount olunur
  // ({open && <SkillModals ... />}) — hər açılışda sahələr təzə başlayır.
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = isControlled ? (open as boolean) : internalOpen

  const [mode, setMode] = useState<SkillMode>(initialMode)
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogItem | null>(null)
  const [level, setLevel] = useState<string>('beginner')
  const [experience, setExperience] = useState<string>('none')
  const [description, setDescription] = useState('')

  const [proposalName, setProposalName] = useState('')
  const [proposalCategory, setProposalCategory] = useState('')
  const [proposalDescription, setProposalDescription] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const [saving, setSaving] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [mainError, setMainError] = useState('')
  const [proposalError, setProposalError] = useState('')
  const [proposalSuccess, setProposalSuccess] = useState(false)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)

  // Kataloq kateqoriyaları (təklif modalının seçim siyahısı üçün)
  const categories = useMemo(
    () => [...new Set(catalog.map(item => item.category))].sort((a, b) => a.localeCompare(b)),
    [catalog]
  )

  // Kataloqu kateqoriyalara görə qruplaşdır (dropdown üçün)
  const groupedCatalog = useMemo(() => {
    const map = new Map<string, SkillCatalogItem[]>()

    for (const item of catalog) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }

    return [...map.entries()]
  }, [catalog])

  function closeAll() {
    setDropdownOpen(false)
    setProposalOpen(false)
    setProposalSuccess(false)
    setMainError('')
    setProposalError('')

    if (!isControlled) {
      setInternalOpen(false)
    } else {
      onClose?.()
    }
  }

  function openMain() {
    // Hər açılışda sahələri təmizlə (nəzarət olunmayan rejimdə komponent
    // mount qalır — event handler-də sıfırlamaq effect-dən təhlükəsizdir)
    setMode(initialMode)
    setSelectedSkill(null)
    setLevel('beginner')
    setExperience('none')
    setDescription('')
    setMainError('')
    setProposalSuccess(false)
    setDropdownOpen(false)
    setProposalOpen(false)
    setInternalOpen(true)
  }

  function closeProposal() {
    setProposalOpen(false)
    setProposalError('')
    setProposalName('')
    setProposalDescription('')
    setConfirmed(false)
  }

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget && !saving) closeAll()
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    if (!selectedSkill || saving) return

    setSaving(true)
    setMainError('')

    try {
      await onSaveSkill({
        mode,
        skillId: selectedSkill.id,
        skill: selectedSkill.name,
        level,
        experience,
        description,
      })

      // Uğur — bağla və sıfırla
      closeAll()
    } catch (err: unknown) {
      setMainError(
        err instanceof Error && err.message
          ? err.message
          : t('skillModals.errorGeneric')
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleProposal(e: React.FormEvent) {
    e.preventDefault()

    if (!proposalName.trim() || !confirmed || proposing) return

    setProposing(true)
    setProposalError('')

    try {
      await onProposeSkill({
        name: proposalName.trim(),
        category: proposalCategory || categories[0] || '',
        description: proposalDescription.trim(),
      })

      // Uğur — təklif modalını bağla, əsas modalda uğur mesajı göstər
      setProposalOpen(false)
      setProposalName('')
      setProposalDescription('')
      setConfirmed(false)
      setProposalSuccess(true)
    } catch (err: unknown) {
      setProposalError(
        err instanceof Error && err.message
          ? err.message
          : t('skillModals.errorGeneric')
      )
    } finally {
      setProposing(false)
    }
  }

  return (
    <>
      {/* Açış düyməsi — yalnız nəzarət olunmayan rejimdə göstərilir */}
      {!isControlled && (
        <button
          onClick={openMain}
          className="rounded-xl bg-gradient-to-r from-purple-700 to-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:scale-[1.02] hover:shadow-lg"
        >
          {t('skillModals.addButton')}
        </button>
      )}

      {/* Əsas bacarıq modalı */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#241044]/60 p-4 backdrop-blur-[2px]"
          onMouseDown={handleBackdrop}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-modal-title"
            className="relative my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <button
              onClick={closeAll}
              disabled={saving}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-purple-50 text-lg text-purple-600 hover:bg-purple-100"
              aria-label={t('skillModals.close')}
            >
              ×
            </button>

            <h2 id="skill-modal-title" className="text-xl font-bold text-[#321078]">
              {t('skillModals.mainTitle')}
            </h2>

            <p className="mt-1 pr-6 text-xs text-gray-500">
              {t('skillModals.mainSubtitle')}
            </p>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div>
                <p className="mb-2 text-center text-sm font-semibold text-[#321078]">
                  {t('skillModals.modeQuestion')}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMode('teach')}
                    className={`rounded-xl border p-3 text-center transition ${
                      mode === 'teach'
                        ? 'border-purple-600 bg-purple-50 text-purple-800'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    <span className="block text-xl" aria-hidden="true">🎓</span>
                    <span className="mt-1 block text-sm font-bold">
                      {t('skillModals.modeTeach')}
                    </span>
                    <span className="mt-1 block text-[11px]">
                      {t('skillModals.modeTeachHint')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('learn')}
                    className={`rounded-xl border p-3 text-center transition ${
                      mode === 'learn'
                        ? 'border-purple-600 bg-purple-50 text-purple-800'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    <span className="block text-xl" aria-hidden="true">📚</span>
                    <span className="mt-1 block text-sm font-bold">
                      {t('skillModals.modeLearn')}
                    </span>
                    <span className="mt-1 block text-[11px]">
                      {t('skillModals.modeLearnHint')}
                    </span>
                  </button>
                </div>
              </div>

              {/* Bacarıq seçimi */}
              <div className="relative">
                <label htmlFor="sm-skill" className="mb-2 block text-sm font-semibold text-[#321078]">
                  {t('skillModals.skillLabel')}
                </label>

                <button
                  type="button"
                  id="sm-skill"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex w-full items-center justify-between rounded-lg border border-purple-200 bg-white px-3 py-3 text-left text-sm text-gray-600 outline-none transition focus:border-purple-500"
                  aria-haspopup="listbox"
                  aria-expanded={dropdownOpen}
                >
                  <span>
                    {selectedSkill?.name ?? t('skillModals.skillPlaceholder')}
                  </span>
                  <span className="text-purple-600" aria-hidden="true">⌄</span>
                </button>

                {dropdownOpen && (
                  <div
                    className="absolute left-0 top-full z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-purple-100 bg-white p-2 shadow-xl"
                    role="listbox"
                  >
                    {catalog.length === 0 && (
                      <p className="px-3 py-4 text-center text-xs text-gray-400">
                        {t('skillModals.catalogLoading')}
                      </p>
                    )}

                    {groupedCatalog.map(([category, items]) => (
                      <div key={category} className="mb-2">
                        <p className="px-3 py-2 text-xs font-bold text-purple-600">
                          {category}
                        </p>

                        {items.map(item => (
                          <button
                            type="button"
                            key={item.id}
                            role="option"
                            aria-selected={selectedSkill?.id === item.id}
                            onClick={() => {
                              setSelectedSkill(item)
                              setDropdownOpen(false)
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-purple-50 ${
                              selectedSkill?.id === item.id
                                ? 'bg-purple-100 font-semibold text-purple-800'
                                : 'text-gray-700'
                            }`}
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => {
                        setDropdownOpen(false)
                        setProposalOpen(true)
                      }}
                      className="w-full rounded-lg bg-purple-50 px-3 py-3 text-center text-sm font-bold text-purple-700 hover:bg-purple-100"
                    >
                      {t('skillModals.proposeButton')}
                    </button>
                  </div>
                )}
              </div>

              {/* Səviyyə və təcrübə */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sm-level" className="mb-2 block text-sm font-semibold text-[#321078]">
                    {t('skillModals.levelLabel')}
                  </label>
                  <select
                    id="sm-level"
                    value={level}
                    onChange={e => setLevel(e.target.value)}
                    className="w-full rounded-lg border border-purple-200 bg-white p-3 text-sm outline-none focus:border-purple-500"
                  >
                    {LEVELS.map(value => (
                      <option key={value} value={value}>
                        {t(`skillModals.level_${value}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sm-experience" className="mb-2 block text-sm font-semibold text-[#321078]">
                    {t('skillModals.experienceLabel')}
                  </label>
                  <select
                    id="sm-experience"
                    value={experience}
                    onChange={e => setExperience(e.target.value)}
                    className="w-full rounded-lg border border-purple-200 bg-white p-3 text-sm outline-none focus:border-purple-500"
                  >
                    {EXPERIENCES.map(value => (
                      <option key={value} value={value}>
                        {t(`skillModals.exp_${value}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Təsvir */}
              <div>
                <label htmlFor="sm-desc" className="mb-2 block text-sm font-semibold text-[#321078]">
                  {t('skillModals.descriptionLabel')}
                </label>
                <textarea
                  id="sm-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder={t('skillModals.descriptionPlaceholder')}
                  className="w-full resize-none rounded-lg border border-purple-200 p-3 text-sm outline-none focus:border-purple-500"
                />
              </div>

              <div className="rounded-lg bg-green-50 p-3 text-xs text-green-800">
                {mode === 'teach'
                  ? t('skillModals.infoTeach')
                  : t('skillModals.infoLearn')}
              </div>

              {proposalSuccess && (
                <div
                  className="rounded-lg bg-green-50 px-3 py-2.5 text-xs font-semibold text-green-800"
                  role="status"
                >
                  {t('skillModals.proposalSuccess')}
                </div>
              )}

              {mainError && (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600"
                  role="alert"
                >
                  {mainError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeAll}
                  disabled={saving}
                  className="rounded-lg border border-purple-300 px-5 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-60"
                >
                  {t('skillModals.cancel')}
                </button>

                <button
                  type="submit"
                  disabled={!selectedSkill || saving}
                  className="rounded-lg bg-purple-700 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? t('skillModals.submitting') : t('skillModals.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Yeni bacarıq təklifi modalı */}
      {proposalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-[#241044]/60 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-modal-title"
            className="relative my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <button
              onClick={closeProposal}
              disabled={proposing}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-purple-50 text-lg text-purple-600"
              aria-label={t('skillModals.close')}
            >
              ×
            </button>

            <h2 id="proposal-modal-title" className="text-xl font-bold text-[#321078]">
              {t('skillModals.proposalTitle')}
            </h2>

            <p className="mt-1 pr-6 text-xs text-gray-500">
              {t('skillModals.proposalSubtitle')}
            </p>

            <form onSubmit={handleProposal} className="mt-5 space-y-4">
              <div>
                <label htmlFor="sm-proposal-name" className="mb-2 block text-sm font-semibold text-[#321078]">
                  {t('skillModals.proposalNameLabel')}
                </label>
                <input
                  id="sm-proposal-name"
                  value={proposalName}
                  onChange={e => setProposalName(e.target.value)}
                  required
                  maxLength={80}
                  placeholder={t('skillModals.proposalNamePlaceholder')}
                  className="w-full rounded-lg border border-purple-200 p-3 text-sm outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label htmlFor="sm-proposal-category" className="mb-2 block text-sm font-semibold text-[#321078]">
                  {t('skillModals.proposalCategoryLabel')}
                </label>
                <select
                  id="sm-proposal-category"
                  value={proposalCategory || categories[0] || ''}
                  onChange={e => setProposalCategory(e.target.value)}
                  className="w-full rounded-lg border border-purple-200 bg-white p-3 text-sm outline-none focus:border-purple-500"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sm-proposal-desc" className="mb-2 block text-sm font-semibold text-[#321078]">
                  {t('skillModals.proposalDescLabel')}
                </label>
                <textarea
                  id="sm-proposal-desc"
                  value={proposalDescription}
                  onChange={e => setProposalDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={t('skillModals.descriptionPlaceholder')}
                  className="w-full resize-none rounded-lg border border-purple-200 p-3 text-sm outline-none focus:border-purple-500"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-purple-50 p-3 text-xs text-[#5d4380]">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="mt-0.5 accent-purple-700"
                />
                <span>{t('skillModals.proposalConfirm')}</span>
              </label>

              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                {t('skillModals.proposalInfo')}
              </div>

              {proposalError && (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600"
                  role="alert"
                >
                  {proposalError}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeProposal}
                  disabled={proposing}
                  className="rounded-lg border border-purple-300 px-5 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-60"
                >
                  {t('skillModals.proposalBack')}
                </button>

                <button
                  type="submit"
                  disabled={!proposalName.trim() || !confirmed || proposing}
                  className="rounded-lg bg-purple-700 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {proposing
                    ? t('skillModals.proposalSubmitting')
                    : t('skillModals.proposalSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
