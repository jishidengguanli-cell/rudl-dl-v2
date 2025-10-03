import type { Locale } from "./locales";
export const href = (lang: Locale, path: string) => `/${lang}${path.startsWith('/') ? path : `/${path}`}`;
