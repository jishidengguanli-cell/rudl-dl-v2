'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';

export default function AdminLoginPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextParam = searchParams?.get('next');
  const nextTarget = nextParam && nextParam.startsWith('/') ? nextParam : `/${locale}/admin`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json: unknown = await response.json();
      if (!response.ok || typeof json !== 'object' || json === null || !(json as { ok?: unknown }).ok) {
        const message = typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : 'LOGIN_FAILED';
        setError(message);
        return;
      }

      const sessionRes = await fetch('/api/auth/session', { method: 'GET', credentials: 'include' });
      const sessionJson = (await sessionRes.json().catch(() => null)) as { ok?: boolean; user?: { role?: string } } | null;
      const role = sessionJson?.user?.role ?? null;
      if ((role ?? '').toLowerCase() !== 'admin') {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        setError(t('admin.login.error') ?? 'Not authorized');
        return;
      }

      router.push(nextTarget);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">{t('admin.login.title')}</h1>
        <p className="text-sm text-gray-600">{t('admin.login.subtitle')}</p>
        <form className="space-y-3" onSubmit={submit}>
          <label className="block text-sm font-medium text-gray-700">
            {t('auth.email')}
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            {t('auth.password')}
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? '...' : t('admin.login.submit')}
          </button>
        </form>
        {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
