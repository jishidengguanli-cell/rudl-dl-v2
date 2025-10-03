import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/i18n/get-messages";
import { t } from "@/i18n/t";
import { locales, defaultLocale, type Locale } from "@/i18n/locales";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export const runtime = "edge";

type LayoutParams = { lang: string };

const resolveLocale = (value: string): Locale =>
  ((locales as readonly string[]).includes(value) ? value : defaultLocale) as Locale;

export default async function LangLayout({
  children,
  params
}: { children: ReactNode; params: Promise<LayoutParams> }) {
  const { lang: requestedLang } = await params;
  const lang = resolveLocale(requestedLang);
  const msgs = await getMessages(lang);
  // 記 cookie 方便下次偵測
  const cookieStore = await cookies();
  cookieStore.set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365 });

  return (
    <html lang={lang}>
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-5xl p-6">
          <header className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">{t(msgs, "app.title")}</h1>
            <LanguageSwitcher current={lang} />
          </header>
          <nav className="mb-6 space-x-4 text-sm">
            <Link className="underline" href={`/${lang}`}>
              {t(msgs, "nav.home")}
            </Link>
            <Link className="underline" href={`/${lang}/dashboard`}>
              {t(msgs, "nav.dashboard")}
            </Link>
            <Link className="underline" href={`/${lang}/playground/bill`}>
              {t(msgs, "nav.billTest")}
            </Link>
          </nav>
          {children}
          <footer className="mt-10 text-xs text-gray-500">© {new Date().getFullYear()} DataruApp</footer>
        </div>
      </body>
    </html>
  );
}