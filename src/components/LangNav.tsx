'use client';

import Link from 'next/link';
import { ChangeEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/dictionary';

const localeOptions: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'zh-TW', label: 'Traditional Chinese' },
  { value: 'zh-CN', label: 'Simplified Chinese' },
  { value: 'en', label: 'English' },
];

const isLocale = (value: string): value is Locale =>
  localeOptions.some((option) => option.value === value);

export default function LangNav() {
  const { t, locale, setLocale } = useI18n();

  const handleLocaleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    if (isLocale(nextValue)) {
      setLocale(nextValue);
    }
  };

  return (
    <header className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold">{t('app.name')}</h1>
      <nav className="space-x-4 text-sm">
        <Link className="underline" href="/">
          {t('nav.home')}
        </Link>
        <Link className="underline" href="/dashboard">
          {t('nav.dashboard')}
        </Link>
        <Link className="underline" href="/playground/bill">
          {t('nav.bill')}
        </Link>
        <Link className="underline" href="/login">
          {t('nav.login')}
        </Link>
        <select
          className="ml-3 rounded border px-2 py-1"
          value={locale}
          onChange={handleLocaleChange}
        >
          {localeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </nav>
    </header>
  );
}
