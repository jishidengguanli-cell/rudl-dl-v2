import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/i18n/get-messages";
import { t } from "@/i18n/t";
import { locales, defaultLocale, type Locale, localeNames } from "@/i18n/locales";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default async function LangLayout({
  children, params
}: { children: ReactNode; params: { lang: string } }) {
  const lang = ((locales as readonly string[]).includes(params.lang) ? params.lang : defaultLocale) as Locale;
  const msgs = await getMessages(lang);
  // 記 cookie 方便下次偵測
  cookies().set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365 });

  return (
    <html lang={lang}>
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-5xl p-6">
          <header className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">{t(msgs, "app.title")}</h1>
            <LanguageSwitcher current={lang} />
          </header>
          <nav className="mb-6 space-x-4 text-sm">
            <a className="underline" href={`/${lang}`}>{t(msgs, "nav.home")}</a>
            <a className="underline" href={`/${lang}/dashboard`}>{t(msgs, "nav.dashboard")}</a>
            <a className="underline" href={`/${lang}/playground/bill`}>{t(msgs, "nav.billTest")}</a>
          </nav>
          {children}
          <footer className="mt-10 text-xs text-gray-500">© {new Date().getFullYear()} DataruApp</footer>
        </div>
      </body>
    </html>
  );
}
