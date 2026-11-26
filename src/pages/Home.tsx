
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function BookIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M8 14C17 11 25 14 32 20V53C24 47 16 45 8 48V14Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M56 14C47 11 39 14 32 20V53C40 47 48 45 56 48V14Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M16 23C21 22 25 24 28 27M16 32C21 31 25 33 28 36M48 23C43 22 39 24 36 27M48 32C43 31 39 33 36 36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" className="h-12 w-12">
      <circle cx="32" cy="19" r="10" />
      <circle cx="13" cy="27" r="7" />
      <circle cx="51" cy="27" r="7" />
      <path d="M12 52C12 40 20 33 32 33C44 33 52 40 52 52V56H12V52Z" />
      <path d="M2 49C2 41 6 36 14 35C18 35 21 37 23 40C19 44 17 49 17 56H2V49Z" />
      <path d="M62 49C62 41 58 36 50 35C46 35 43 37 41 40C45 44 47 49 47 56H62V49Z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="h-12 w-12">
      <path d="M10 54V39H21V54H10ZM27 54V28H38V54H27ZM44 54V17H55V54H44Z" fill="currentColor" />
      <path d="M10 29L25 19L35 25L53 8M43 8H53V18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Home() {
  const { t } = useTranslation()

  const steps = [
    {
      title: t('home.step1Title'),
      description: t('home.step1Description'),
      icon: <BookIcon />,
    },
    {
      title: t('home.step2Title'),
      description: t('home.step2Description'),
      icon: <PeopleIcon />,
    },
    {
      title: t('home.step3Title'),
      description: t('home.step3Description'),
      icon: <ChartIcon />,
    },
  ]

  return (
    <main className="overflow-hidden bg-[#fbf9ff] text-[#21104f]">

      {/* HERO SECTION */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-8 px-6 pb-12 pt-12 lg:min-h-[450px] lg:grid-cols-2 lg:px-10">

        <div className="relative z-10">
          <span className="inline-flex rounded-full bg-[#ead8ff] px-6 py-3 text-sm font-semibold text-[#7022bd]">
            {t('home.eyebrow')}
          </span>

          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-5xl lg:text-[58px]">
            {t('home.titleBefore')}{' '}
            <span className="text-[#861bd1]">
              {t('home.titleHighlight')}
            </span>
            {t('home.titleAfter')}
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#49366d]">
            {t('home.description')}
          </p>

          <div className="mt-7 flex flex-wrap gap-4">
            <Link
              to="/skills"
              className="rounded-full bg-gradient-to-r from-[#7900c8] to-[#9217d8] px-9 py-4 font-semibold text-white shadow-lg shadow-purple-200 transition hover:-translate-y-1 hover:shadow-xl"
            >
              {t('home.explore')}
            </Link>

            <Link
              to="/register"
              className="rounded-full border-2 border-[#851bd0] px-9 py-4 font-semibold text-[#7919bd] transition hover:bg-[#f1e4ff]"
            >
              {t('home.join')}
            </Link>
          </div>
        </div>

        <div className="relative flex min-h-[340px] items-center justify-center lg:min-h-[420px]">
          <div className="absolute right-4 top-3 h-72 w-72 rounded-full bg-[#ead5ff] opacity-60 blur-3xl" />

          <img
            src="/crow-mascot.png"
            alt={t('home.mascotAlt')}
            className="relative z-10 max-h-[420px] w-full max-w-[490px] object-contain"
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-7xl px-6 py-8 lg:px-10">

        <div className="mb-9 text-center">
          <div className="mx-auto mb-3 flex max-w-5xl items-center gap-6">
            <div className="h-px flex-1 bg-[#dfc5fa]" />

            <h2 className="text-3xl font-extrabold sm:text-4xl">
              {t('home.howTitle')}
            </h2>

            <div className="h-px flex-1 bg-[#dfc5fa]" />
          </div>

          <p className="text-lg text-[#6b548c]">
            {t('home.howSubtitle')}
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.title}
              className="flex items-center gap-5 rounded-3xl border border-[#ead9ff] bg-gradient-to-br from-white to-[#f2e8ff] p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#e8d3ff] text-[#7020b8]">
                {step.icon}
              </div>

              <div>
                <h3 className="text-lg font-bold">
                  {step.title}
                </h3>

                <p className="mt-2 text-sm leading-6 text-[#60477f]">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CALL TO ACTION */}
      <section className="mx-auto max-w-7xl px-6 pb-10 pt-8 lg:px-10">
        <div className="flex flex-col items-start justify-between gap-6 rounded-[30px] bg-gradient-to-r from-[#51208c] via-[#7523b9] to-[#6321a4] px-8 py-9 text-white shadow-lg sm:flex-row sm:items-center sm:px-14">

          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl">
              {t('home.ctaTitle')}
            </h2>

            <p className="mt-2 text-base text-purple-100 sm:text-lg">
              {t('home.ctaDescription')}
            </p>
          </div>

          <Link
            to="/register"
            className="shrink-0 rounded-full bg-[#d9f8b9] px-8 py-4 font-bold text-[#32145d] transition hover:-translate-y-1 hover:bg-[#c9f3a2]"
          >
            {t('home.ctaButton')}
          </Link>

        </div>
      </section>

    </main>
  )
}

export default Home
