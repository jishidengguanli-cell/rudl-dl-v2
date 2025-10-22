'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, type Locale } from './dictionary';
import { createTranslator, isLocale } from './helpers';

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
};

const I18nCtx = createContext<Ctx | null>(null);
const LS_KEY = 'locale';

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Prefer the persisted locale on the client when available
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const segments = window.location.pathname.split('/').filter(Boolean);
    const pathLocale = segments[0];
    if (pathLocale && isLocale(pathLocale)) return;
    const saved = localStorage.getItem(LS_KEY) as Locale | null;
    if (saved && isLocale(saved)) setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_KEY, l);
      const cookie = `Path=/; Max-Age=31536000; SameSite=Lax`;
      document.cookie = `locale=${l}; ${cookie}`;
      document.cookie = `lang=${l}; ${cookie}`;
    }
  };

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
