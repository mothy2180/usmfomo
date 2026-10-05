import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from '../locales/en/common.json'
import enDashboard from '../locales/en/dashboard.json'
import enErrors from '../locales/en/errors.json'
import enLanding from '../locales/en/landing.json'
import enStudio from '../locales/en/studio.json'
import msCommon from '../locales/ms/common.json'
import msDashboard from '../locales/ms/dashboard.json'
import msErrors from '../locales/ms/errors.json'
import msLanding from '../locales/ms/landing.json'
import msStudio from '../locales/ms/studio.json'

export type Lang = 'en' | 'ms'
const STORAGE_KEY = 'usmfomo.lang'

function initialLanguage(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ms') return saved
  } catch {
    // storage blocked (private mode): fall through
  }
  return navigator.language?.toLowerCase().startsWith('ms') ? 'ms' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, dashboard: enDashboard, errors: enErrors, landing: enLanding, studio: enStudio },
    ms: { common: msCommon, dashboard: msDashboard, errors: msErrors, landing: msLanding, studio: msStudio },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  ns: ['common', 'dashboard', 'errors', 'landing', 'studio'],
  defaultNS: 'common',
  // React escapes output; never render translations as HTML.
  interpolation: { escapeValue: false },
  returnNull: false,
})
document.documentElement.lang = i18n.language

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // ignore
  }
}

export function currentLang(): Lang {
  return i18n.language === 'ms' ? 'ms' : 'en'
}

export default i18n
