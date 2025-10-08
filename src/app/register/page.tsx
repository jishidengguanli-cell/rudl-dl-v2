'use client';
export const runtime = 'edge';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';

export default function RegisterPage() {
  const { t } = useI18n();
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
      const j = await r.json();
      if (j.ok) {
        setOut(t('auth.register.success') ?? 'Registered');
        location.href = '/login';
      } else {
        setOut(j.error ?? 'Register failed');
      }
    } catch (e: any) {
      setOut(String(e?.message ?? e));
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-medium">{t('auth.register.title') ?? 'Register'}</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.email') ?? 'Email'}</div>
          <input className="w-full rounded border px-2 py-1" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password') ?? 'Password'}</div>
          <input className="w-full rounded border px-2 py-1" type="password" value={pw} onChange={e=>setPw(e.target.value)} required minLength={6} />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('auth.password.confirm') ?? 'Confirm password'}</div>
          <input className="w-full rounded border px-2 py-1" type="password" value={pw2} onChange={e=>setPw2(e.target.value)} required minLength={6} />
        </label>
        <button className="rounded bg-black px-3 py-1 text-white" type="submit">
          {t('auth.register.submit') ?? 'Sign up'}
        </button>
      </form>
      {out && <pre className="rounded bg-gray-100 p-3 text-xs whitespace-pre-wrap">{out}</pre>}
    </div>
  );
}
