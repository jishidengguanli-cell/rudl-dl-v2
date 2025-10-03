'use client';

import { useI18n } from '@/i18n/provider';

export default function LangNav() {
  const { t, locale, setLocale } = useI18n();
  return (
    <header className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold">{t('app.name')}</h1>
      <nav className="space-x-4 text-sm">
        <a className="underline" href="/">{t('nav.home')}</a>
        <a className="underline" href="/dashboard">{t('nav.dashboard')}</a>
        <a className="underline" href="/playground/bill">{t('nav.bill')}</a>
        <select
          className="ml-3 rounded border px-2 py-1"
          value={locale}
          onChange={(e) => setLocale(e.target.value as any)}
        >
          <option value="zh-TW">繁中</option>
          <option value="zh-CN">简中</option>
          <option value="en">EN</option>
        </select>
      </nav>
    </header>
  );
}
