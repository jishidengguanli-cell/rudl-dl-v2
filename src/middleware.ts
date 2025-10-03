import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, locales } from "./i18n/locales";

function detect(req: NextRequest): string {
  const cookieLang = req.cookies.get("lang")?.value;
  if (cookieLang && (locales as readonly string[]).includes(cookieLang)) return cookieLang;

  const accept = req.headers.get("accept-language") ?? "";
  const found = accept.split(",").map(s => s.split(";")[0].trim());
  for (const l of found) {
    if ((locales as readonly string[]).includes(l)) return l;
    if (l.startsWith("zh")) return "zh-TW";
    if (l.startsWith("en")) return "en";
  }
  return defaultLocale;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 略過不應處理的路徑
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/dl") || // 讓 302 下載 route 照舊
    pathname === "/favicon.ico"
  ) {
    return;
  }

  const hasLocale = (locales as readonly string[]).some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  );

  if (!hasLocale) {
    const lang = detect(req);
    const url = req.nextUrl.clone();
    url.pathname = `/${lang}${pathname}`;
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"]
};
