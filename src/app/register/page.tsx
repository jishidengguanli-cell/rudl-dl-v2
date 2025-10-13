'use client';
export const runtime = 'edge';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';

export default function RegisterPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get('next');
  const nextPath = useMemo(() => {
    if (!nextRaw) return '/dashboard';
    return nextRaw.startsWith('/') ? nextRaw : '/dashboard';
  }, [nextRaw]);

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
      const json: unknown = await r.json();
      if (typeof json === 'object' && json !== null && 'ok' in json && typeof (json as { ok: unknown }).ok === 'boolean') {
        const payload = json as { ok: boolean; error?: unknown };
        if (payload.ok) {
          setOut(t('auth.register.success') ?? 'Registered');
          const params = new URLSearchParams({ next: nextPath, reason: 'registered' });
          location.href = `/login?${params.toString()}`;
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
    <div className="mx-auto max-w-md rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-medium">{t('auth.register.title') ?? 'Register'}</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.email') ?? 'Email'}</div>
          <input className="w-full rounded border px-2 py-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password') ?? 'Password'}</div>
          <input className="w-full rounded border px-2 py-1" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password.confirm') ?? 'Confirm password'}</div>
          <input className="w-full rounded border px-2 py-1" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} />
        </label>
        <button className="rounded bg-black px-3 py-1 text-white" type="submit">
          {t('auth.register.submit') ?? 'Sign up'}
        </button>
      </form>
      {out && <pre className="rounded bg-gray-100 p-3 text-xs whitespace-pre-wrap">{out}</pre>}
      <p className="text-sm text-gray-600">
        <Link className="text-blue-600 underline" href={`/login?next=${encodeURIComponent(nextPath)}`}>
          {t('auth.login.title') ?? 'Login'}
        </Link>
      </p>
    </div>
  );
}
