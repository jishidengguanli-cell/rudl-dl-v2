'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useI18n } from '@/i18n/provider';
import { isLanguageCode } from '@/lib/language';

const normalizePath = (value: string) => value.replace(/\/+$/, '') || '/';

const NAV_ITEMS = [
  { href: '/monitor', labelKey: 'monitor.nav.overview' },
  { href: '/monitor/privacy', labelKey: 'monitor.nav.privacy' },
  { href: '/monitor/tool', labelKey: 'monitor.nav.tools' },
];

export default function MonitorNav() {
  const { t } = useI18n();
  const pathname = usePathname() ?? '/';
  const normalizedPath = useMemo(() => normalizePath(pathname), [pathname]);
  const segments = useMemo(() => normalizedPath.split('/').filter(Boolean), [normalizedPath]);
  const localeSegment = segments.length > 0 && isLanguageCode(segments[0]) ? segments[0] : null;
  const localePrefix = localeSegment ? `/${localeSegment}` : '';

  const buildHref = (path: string) => {
    if (path === '/') return localePrefix || '/';
    return `${localePrefix}${path}`;
  };

  const linkClass = (href: string) => {
    const target = normalizePath(href);
    const isActive = normalizedPath === target || normalizedPath.startsWith(`${target}/`);
    const base = 'inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm transition';
    const active = 'border-blue-500 bg-blue-50 text-blue-700';
    const inactive = 'border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600';
    return `${base} ${isActive ? active : inactive}`;
  };

  return (
    <nav className="flex flex-wrap items-center gap-3 text-sm">
      {NAV_ITEMS.map((item) => {
        const target = buildHref(item.href);
        return (
          <Link key={item.href} className={linkClass(target)} href={target}>
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
