'use client';

import { ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { I18nProvider, useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/dictionary';
import LangNav from '@/components/LangNav';

const AUTH_SEGMENTS = new Set(['login', 'register']);

function useIsAuthRoute() {
  const pathname = usePathname() ?? '';
  if (!pathname) return false;
  const segments = pathname.split('/').filter(Boolean);
  return segments.some((segment) => AUTH_SEGMENTS.has(segment));
}

function LocaleSync({ locale, pathnameLocale }: { locale: Locale; pathnameLocale: Locale | null }) {
  const { locale: current, setLocale } = useI18n();
  useEffect(() => {
    if (pathnameLocale && pathnameLocale !== current) {
      setLocale(pathnameLocale);
    } else if (!pathnameLocale && current !== locale) {
      setLocale(locale);
    }
  }, [current, locale, pathnameLocale, setLocale]);
  return null;
}

function inferLocaleFromPath(pathname: string | null): Locale | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  const candidate = segments[0] as Locale | undefined;
  if (!candidate) return null;
  if (candidate === 'zh-TW' || candidate === 'en' || candidate === 'zh-CN') return candidate;
  return null;
}

export default function AppShell({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const pathnameLocale = inferLocaleFromPath(pathname);
  const isAuthRoute = useIsAuthRoute();

  const wrapperClass = isAuthRoute ? 'min-h-screen bg-black text-white' : 'min-h-screen bg-gray-50 text-gray-900';

  return (
    <I18nProvider initialLocale={pathnameLocale ?? initialLocale}>
      <LocaleSync locale={initialLocale} pathnameLocale={pathnameLocale} />
      <div className={wrapperClass}>
        {isAuthRoute ? (
          <main className="flex min-h-screen items-center justify-center p-6">{children}</main>
        ) : (
          <div className="mx-auto max-w-5xl p-6">
            <LangNav />
            <main>{children}</main>
            <footer className="mt-10 text-xs text-gray-500">
              © {new Date().getFullYear()} DataruApp
            </footer>
          </div>
        )}
      </div>
    </I18nProvider>
  );
}
