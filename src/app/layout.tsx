import './globals.css';
import { cookies } from 'next/headers';
import { I18nProvider } from '@/i18n/provider';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import LangNav from '@/components/LangNav';

export const metadata = { title: 'DataruApp V2', description: 'Next + Cloudflare Pages' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const c = cookieStore.get('locale')?.value as Locale | undefined;
  const initialLocale = c && dictionaries[c] ? c : DEFAULT_LOCALE;

  return (
    <html lang={initialLocale === 'en' ? 'en' : initialLocale === 'zh-CN' ? 'zh-CN' : 'zh-Hant'}>
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-5xl p-6">
          <I18nProvider initialLocale={initialLocale}>
            <LangNav />
            <main>{children}</main>
            <footer className="mt-10 text-xs text-gray-500">
              © {new Date().getFullYear()} DataruApp
            </footer>
          </I18nProvider>
        </div>
      </body>
    </html>
  );
}
