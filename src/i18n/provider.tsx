'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, dictionaries, type Locale } from './dictionary';

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

  // 初始：優先 localStorage
  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem(LS_KEY)) as Locale | null;
    if (saved && dictionaries[saved]) setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_KEY, l);
      document.cookie = `locale=${l}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  };

  const t = useMemo(() => {
    const dict = dictionaries[locale] ?? {};
    return (key: string) => dict[key] ?? key;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Server Component 取得 t（用 cookie 或預設語系） */
export function getT(locale: string | undefined) {
  const l = (locale as any) ?? DEFAULT_LOCALE;
  const dict = dictionaries[l as keyof typeof dictionaries] ?? dictionaries[DEFAULT_LOCALE];
  return (key: string) => dict[key] ?? key;
}
