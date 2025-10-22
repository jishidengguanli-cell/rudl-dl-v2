import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, locales } from "./i18n/locales";
import { isLanguageCode, tryNormalizeLanguageCode } from "./lib/language";

type LocaleValue = (typeof locales)[number];

function detect(req: NextRequest): LocaleValue {
  const cookieLang = req.cookies.get("lang")?.value;
  const normalizedCookie = cookieLang ? tryNormalizeLanguageCode(cookieLang) : null;
  if (normalizedCookie && isLanguageCode(normalizedCookie)) return normalizedCookie as LocaleValue;

  const accept = req.headers.get("accept-language") ?? "";
  const found = accept.split(",").map((s) => s.split(";")[0].trim());
  for (const candidate of found) {
    const normalized = tryNormalizeLanguageCode(candidate);
    if (normalized && isLanguageCode(normalized)) return normalized as LocaleValue;
  }
  return defaultLocale;
}

const shouldBypass = (pathname: string) =>
  pathname.startsWith("/_next") ||
  pathname.startsWith("/api") ||
  pathname.startsWith("/dl") ||
  pathname === "/favicon.ico";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (shouldBypass(pathname)) {
    return NextResponse.next();
  }

  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0];
  const isKnownLocale = (locales as readonly string[]).includes(maybeLocale ?? "");

  if (!isKnownLocale) {
    const lang = detect(req);
    const url = req.nextUrl.clone();
    url.pathname = `/${lang}${pathname}`;
    const res = NextResponse.redirect(url);
    res.cookies.set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  }

  const response = NextResponse.next();
  const cookieLang = req.cookies.get("lang")?.value;
  if (!cookieLang || cookieLang !== maybeLocale) {
    response.cookies.set("lang", maybeLocale as LocaleValue, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"]
};