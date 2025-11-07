import './globals.css';
import { cookies } from 'next/headers';
import AppShell from '@/components/AppShell';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

export const metadata = {
  title: 'DataruApp V2',
  description: 'Next + Cloudflare Pages',
  icons: {
    icon: '/images/icon.png',
    shortcut: '/images/icon.png',
    apple: '/images/icon.png',
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
