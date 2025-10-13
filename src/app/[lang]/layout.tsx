import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

type LayoutParams = { lang: string };

const isLocale = (value: string): value is Locale => value in dictionaries;

export default async function LangLayout({
  children,
  params
}: { children: ReactNode; params: Promise<LayoutParams> }) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;
  const cookieStore = await cookies();
  const existing = cookieStore.get('locale')?.value as Locale | undefined;
  if (existing !== locale) {
    cookieStore.set('locale', locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax'
    });
  }

  return <>{children}</>;
}
