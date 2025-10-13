import './globals.css';
import { cookies } from 'next/headers';
import AppShell from '@/components/AppShell';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

export const metadata = { title: 'DataruApp V2', description: 'Next + Cloudflare Pages' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('locale')?.value as Locale | undefined;
  const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
  const inferredLocale = localeCookie && dictionaries[localeCookie] ? localeCookie : undefined;
  const fallbackLocale = langCookie && dictionaries[langCookie] ? langCookie : undefined;
  const initialLocale = inferredLocale ?? fallbackLocale ?? DEFAULT_LOCALE;

  return (
    <html lang={initialLocale === 'en' ? 'en' : initialLocale === 'zh-CN' ? 'zh-CN' : 'zh-Hant'}>
      <body>
        <AppShell initialLocale={initialLocale}>{children}</AppShell>
      </body>
    </html>
  );
}
