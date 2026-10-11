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
import zhCommon from '../locales/zh/common.json'
import zhDashboard from '../locales/zh/dashboard.json'
import zhErrors from '../locales/zh/errors.json'
import zhLanding from '../locales/zh/landing.json'
import zhStudio from '../locales/zh/studio.json'

export type Lang = 'en' | 'ms' | 'zh'
export const LANGS: readonly Lang[] = ['en', 'ms', 'zh']
const STORAGE_KEY = 'usmfomo.lang'

function initialLanguage(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang
  } catch {
    // storage blocked (private mode): fall through
  }
  const nav = navigator.language?.toLowerCase() ?? ''
  return nav.startsWith('ms') ? 'ms' : nav.startsWith('zh') ? 'zh' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, dashboard: enDashboard, errors: enErrors, landing: enLanding, studio: enStudio },
    ms: { common: msCommon, dashboard: msDashboard, errors: msErrors, landing: msLanding, studio: msStudio },
    zh: { common: zhCommon, dashboard: zhDashboard, errors: zhErrors, landing: zhLanding, studio: zhStudio },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  ns: ['common', 'dashboard', 'errors', 'landing', 'studio'],
  defaultNS: 'common',
  // React escapes output; never render translations as HTML.
  interpolation: { escapeValue: false },
  returnNull: false,
})
document.documentElement.lang = htmlLang(currentLang())

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang)
  document.documentElement.lang = htmlLang(lang)
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // ignore
  }
}

export function currentLang(): Lang {
  return (LANGS as readonly string[]).includes(i18n.language) ? (i18n.language as Lang) : 'en'
}

/** The page's lang attribute (screen readers pick their voice from it). */
function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-Hans' : lang
}

export default i18n
