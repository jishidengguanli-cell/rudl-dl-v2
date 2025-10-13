'use client';
export const runtime = 'edge';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';

const SUPPORTED_LOCALES = new Set(['zh-TW', 'en', 'zh-CN']);

export default function RegisterPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const localePrefix = useMemo(() => {
    if (!pathname) return '';
    const [firstSegment] = pathname.split('/').filter(Boolean);
    return firstSegment && SUPPORTED_LOCALES.has(firstSegment) ? `/${firstSegment}` : '';
  }, [pathname]);
  const nextRaw = searchParams.get('next');
  const defaultNext = localePrefix ? `${localePrefix}/dashboard` : '/dashboard';
  const nextPath = useMemo(() => {
    if (!nextRaw) return defaultNext;
    if (!nextRaw.startsWith('/')) return defaultNext;
    if (!localePrefix) return nextRaw;
    if (nextRaw === localePrefix || nextRaw.startsWith(`${localePrefix}/`)) return nextRaw;
    return `${localePrefix}${nextRaw}`;
  }, [defaultNext, localePrefix, nextRaw]);

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [out, setOut] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) {
      setOut(t('auth.register.mismatch') ?? 'Passwords do not match');
      return;
    }
    setOut('loading...');
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: pw }),
      });
      const contentType = r.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await r.text();
        setOut(text || 'Unexpected response');
        return;
      }
      const json: unknown = await r.json().catch(() => null);
      if (
        typeof json === 'object' &&
        json !== null &&
        'ok' in json &&
        typeof (json as { ok: unknown }).ok === 'boolean'
      ) {
        const payload = json as { ok: boolean; error?: unknown };
        if (payload.ok) {
          setOut(t('auth.register.success') ?? 'Registered');
          const params = new URLSearchParams({ next: nextPath, reason: 'registered' });
          const base = localePrefix || '';
          location.href = `${base}/login?${params.toString()}`;
          return;
        }
        const message = typeof payload.error === 'string' ? payload.error : 'Register failed';
        setOut(message);
        return;
      }
      setOut('Unexpected response');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setOut(message);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6 text-white shadow-lg shadow-black/40 space-y-4">
      <h2 className="text-lg font-medium text-white">{t('auth.register.title') ?? 'Register'}</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.email') ?? 'Email'}</div>
          <input
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white placeholder-neutral-400"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password') ?? 'Password'}</div>
          <input
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white placeholder-neutral-400"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password.confirm') ?? 'Confirm password'}</div>
          <input
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-white placeholder-neutral-400"
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <button className="w-full rounded bg-white px-3 py-1 font-medium text-black transition hover:bg-neutral-200" type="submit">
          {t('auth.register.submit') ?? 'Sign up'}
        </button>
      </form>
      {out && (
        <pre className="rounded bg-neutral-800 p-3 text-xs text-neutral-100 whitespace-pre-wrap border border-neutral-700">
          {out}
        </pre>
      )}
      <p className="text-sm text-neutral-300">
        <Link className="text-blue-300 underline" href={`${localePrefix || ''}/login?next=${encodeURIComponent(nextPath)}`}>
          {t('auth.login.title') ?? 'Login'}
        </Link>
      </p>
    </div>
  );
}
