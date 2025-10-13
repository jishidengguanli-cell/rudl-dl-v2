'use client';
export const runtime = 'edge';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';

export default function LoginPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get('next');
  const reason = searchParams.get('reason');
  const nextPath = useMemo(() => {
    if (!nextRaw) return '/dashboard';
    return nextRaw.startsWith('/') ? nextRaw : '/dashboard';
  }, [nextRaw]);

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
      const json: unknown = await r.json();
      if (typeof json === 'object' && json !== null && 'ok' in json && typeof (json as { ok: unknown }).ok === 'boolean') {
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
    return qs ? `/register?${qs}` : '/register';
  }, [nextPath]);

  return (
    <div className="mx-auto max-w-md rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-medium">{t('auth.login.title') ?? 'Login'}</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.email') ?? 'Email'}</div>
          <input className="w-full rounded border px-2 py-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password') ?? 'Password'}</div>
          <input className="w-full rounded border px-2 py-1" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        <button className="rounded bg-black px-3 py-1 text-white" type="submit">
          {t('auth.login.submit') ?? 'Sign in'}
        </button>
      </form>
      {out && <pre className="rounded bg-gray-100 p-3 text-xs whitespace-pre-wrap">{out}</pre>}
      <p className="text-sm text-gray-600">
        {t('auth.login.registerCta') ?? 'Need an account?'}{' '}
        <Link className="text-blue-600 underline" href={registerHref}>
          {t('auth.login.registerLink') ?? 'Create one'}
        </Link>
      </p>
    </div>
  );
}
