'use client';
export const runtime = 'edge';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';

const SUPPORTED_LOCALES = new Set(['zh-TW', 'en', 'zh-CN']);

export default function LoginPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const localePrefix = useMemo(() => {
    if (!pathname) return '';
    const [firstSegment] = pathname.split('/').filter(Boolean);
    return firstSegment && SUPPORTED_LOCALES.has(firstSegment) ? `/${firstSegment}` : '';
  }, [pathname]);
  const nextRaw = searchParams.get('next');
  const reason = searchParams.get('reason');
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
  const [out, setOut] = useState<string>('');

  useEffect(() => {
    if (reason === 'auth') {
      setOut(t('auth.login.required') ?? 'Please sign in first');
      return;
    }
    if (reason === 'registered') {
      setOut(t('auth.register.success') ?? 'Registered successfully');
    }
  }, [reason, t]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOut('loading...');
    try {
      const r = await fetch('/api/auth/login', {
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
          setOut(t('auth.login.success') ?? 'Login success');
          location.href = nextPath;
          return;
        }
        const message = typeof payload.error === 'string' ? payload.error : 'Login failed';
        setOut(message);
        return;
      }
      setOut('Unexpected response');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setOut(message);
    }
  };

  const registerHref = useMemo(() => {
    const params = new URLSearchParams();
    if (nextPath) params.set('next', nextPath);
    const qs = params.toString();
    const base = localePrefix || '';
    return qs ? `${base}/register?${qs}` : `${base}/register`;
  }, [localePrefix, nextPath]);

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6 text-white shadow-lg shadow-black/40 space-y-4">
      <h2 className="text-lg font-medium text-white">{t('auth.login.title') ?? 'Login'}</h2>
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
          />
        </label>
        <button className="w-full rounded bg-white px-3 py-1 font-medium text-black transition hover:bg-neutral-200" type="submit">
          {t('auth.login.submit') ?? 'Sign in'}
        </button>
      </form>
      {out && (
        <pre className="rounded bg-neutral-800 p-3 text-xs text-neutral-100 whitespace-pre-wrap border border-neutral-700">
          {out}
        </pre>
      )}
      <p className="text-sm text-neutral-300">
        {t('auth.login.registerCta') ?? 'Need an account?'}{' '}
        <Link className="text-blue-300 underline" href={registerHref}>
          {t('auth.login.registerLink') ?? 'Create one'}
        </Link>
      </p>
    </div>
  );
}
