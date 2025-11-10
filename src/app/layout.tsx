import './globals.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import AppShell from '@/components/AppShell';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'DataruApp V2',
  description: 'Next + Cloudflare Pages',
  icons: {
    icon: [
      { url: '/favicon.ico', rel: 'icon', type: 'image/x-icon' },
      { url: '/images/icon.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: ['/images/icon.png'],
    apple: [{ url: '/images/icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('locale')?.value as Locale | undefined;
  const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
  const primaryLocale = langCookie && dictionaries[langCookie] ? langCookie : undefined;
  const secondaryLocale = localeCookie && dictionaries[localeCookie] ? localeCookie : undefined;
  const initialLocale = primaryLocale ?? secondaryLocale ?? DEFAULT_LOCALE;

  return (
    <html lang={(() => {
        switch (initialLocale) {
          case 'zh-CN':
            return 'zh-CN';
          case 'zh-TW':
            return 'zh-Hant';
          case 'ru':
            return 'ru';
          case 'vi':
            return 'vi';
          default:
            return 'en';
        }
      })()}>
      <body>
        <AppShell initialLocale={initialLocale}>{children}</AppShell>
      </body>
    </html>
  );
}
