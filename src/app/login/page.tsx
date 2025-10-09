'use client';
export const runtime = 'edge';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [out, setOut] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOut('loading...');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: pw }),
      });
      const j = await r.json();
      if (j.ok) {
        setOut(t('auth.login.success') ?? 'Login success');
        // 可選：導向 Dashboard
        location.href = '/dashboard';
      } else {
        setOut(j.error ?? 'Login failed');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setOut(message);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-medium">{t('auth.login.title') ?? 'Login'}</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.email') ?? 'Email'}</div>
          <input className="w-full rounded border px-2 py-1" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password') ?? 'Password'}</div>
          <input className="w-full rounded border px-2 py-1" type="password" value={pw} onChange={e=>setPw(e.target.value)} required />
        </label>
        <button className="rounded bg-black px-3 py-1 text-white" type="submit">
          {t('auth.login.submit') ?? 'Sign in'}
        </button>
      </form>
      {out && <pre className="rounded bg-gray-100 p-3 text-xs whitespace-pre-wrap">{out}</pre>}
    </div>
  );
}
