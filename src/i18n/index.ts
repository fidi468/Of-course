import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import az from '../locales/az/translation.json'
import en from '../locales/en/translation.json'
import ru from '../locales/ru/translation.json'
import tr from '../locales/tr/translation.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      az: { translation: az },
      en: { translation: en },
      ru: { translation: ru },
      tr: { translation: tr },
    },
    fallbackLng: 'az',
    supportedLngs: ['az', 'en', 'ru', 'tr'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  })

// <html lang> atributunu seçilmiş dillə sinxronlaşdırır — brauzerin avtomatik
// tərcüməsi UI mətnləri ilə xəta mesajlarını qarışdırmasın
function syncHtmlLang() {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'az'
}

i18n.on('languageChanged', syncHtmlLang)
i18n.on('initialized', syncHtmlLang)

// Mənbələr daxili (bundled) olduğundan init sinxron tamamlana bilər və
// 'initialized' hadisəsi handler-lər qoşulmamışdan əvvəl gələ bilər —
// ona görə ilkin sinxronlaşdırmanı burada da işə salırıq
syncHtmlLang()
Promise.resolve().then(syncHtmlLang)

export default i18n
