"use client";

import { usePathname, useRouter } from "next/navigation";
import { locales, localeNames, type Locale } from "@/i18n/locales";

export default function LanguageSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const pathname = usePathname();

  const change = (next: Locale) => {
    const parts = pathname.split("/");
    parts[1] = next; // 替換第一段語系
    document.cookie = `lang=${next}; path=/; max-age=31536000`;
    router.push(parts.join("/"));
  };

  return (
    <select className="border rounded px-2 py-1 text-sm" value={current} onChange={(e) => change(e.target.value as Locale)}>
      {locales.map((l) => (
        <option key={l} value={l}>{localeNames[l]}</option>
      ))}
    </select>
  );
}
