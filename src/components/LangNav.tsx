'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { isLanguageCode, languageCodes, type LangCode } from '@/lib/language';

export default function LangNav() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const languageOptions = useMemo(
    () =>
      languageCodes.map((code) => ({
        value: code,
        label: t(`language.name.${code}`),
      })),
    [t]
  );
  const [session, setSession] = useState<{ id: string; email: string | null; role: string | null } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object' && 'ok' in data && data.ok) {
          return (data as { user?: { id: string; email?: string | null } }).user ?? null;
        }
        return null;
      })
      .then((user) => {
        if (cancelled) return;
        setSession(user ? { id: user.id, email: user.email ?? null, role: (user as { role?: string | null }).role ?? null } : null);
        setSessionLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setSessionLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changePathToLocale = (next: LangCode) => {
    if (typeof window === 'undefined') {
      router.push(`/${next}`);
      return;
    }
    const url = new URL(window.location.href);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length) {
      segments[0] = next;
    } else {
      segments.push(next);
    }
    url.pathname = `/${segments.join('/')}`;
    url.searchParams.delete('lang');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    router.push(nextUrl);
  };

  const handleLocaleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    if (isLanguageCode(nextValue)) {
      setLocale(nextValue);
      changePathToLocale(nextValue);
    }
  };

  const localePrefix = `/${locale}`;
  const accountLabel = session?.email ?? session?.id ?? null;

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setSession(null);
    } catch {
      // ignore
    } finally {
      const target = resolveHref('/login');
      if (typeof window !== 'undefined') {
        window.location.href = target;
      }
    }
  };

  const resolveHref = (path: string) => {
    if (path === '/') return localePrefix;
    if (path.startsWith('/')) return `${localePrefix}${path}`;
    return `${localePrefix}/${path}`;
  };

  return (
    <header className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <span>{t('app.name')}</span>
        {accountLabel ? (
          <span className="text-sm text-gray-500 whitespace-nowrap">({accountLabel})</span>
        ) : null}
      </h1>
      <nav className="flex items-center gap-4 text-sm">
        <Link className="underline" href={resolveHref('/')}>
          {t('nav.home')}
        </Link>
        <Link className="underline" href={resolveHref('/dashboard')}>
          {t('nav.dashboard')}
        </Link>
        {session ? (
          <Link className="underline" href={resolveHref('/monitor')}>
            {t('nav.monitor')}
          </Link>
        ) : null}
        {session ? (
          <Link className="underline" href={resolveHref('/member')}>
            {t('nav.member')}
          </Link>
        ) : null}
        {sessionLoaded && !session ? (
          <Link className="underline" href={resolveHref('/login')}>
            {t('nav.login')}
          </Link>
        ) : null}
        {session ? (
          <button
            type="button"
            className="text-blue-600 underline"
            onClick={handleLogout}
          >
            {t('nav.logout')}
          </button>
        ) : null}
        <select
          className="ml-3 rounded border px-2 py-1"
          value={locale}
          onChange={handleLocaleChange}
        >
          {languageOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </nav>
    </header>
  );
}
