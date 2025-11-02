'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { isLanguageCode } from '@/lib/language';

const normalizePath = (value: string) => value.replace(/\/+$/, '') || '/';

export default function MemberNav() {
  const { t } = useI18n();
  const pathname = usePathname() ?? '/';
  const normalizedPath = useMemo(() => normalizePath(pathname), [pathname]);
  const segments = useMemo(() => normalizedPath.split('/').filter(Boolean), [normalizedPath]);
  const localeSegment = segments.length > 0 && isLanguageCode(segments[0]) ? segments[0] : null;
  const localePrefix = localeSegment ? `/${localeSegment}` : '';
  const memberHome = `${localePrefix}/member`;
  const historyPath = `${memberHome}/orders/history`;

  const [ordersOpen, setOrdersOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!ordersOpen) return;
      const target = event.target as Node | null;
      if (dropdownRef.current && target && !dropdownRef.current.contains(target)) {
        setOrdersOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [ordersOpen]);

  useEffect(() => {
    setOrdersOpen(false);
  }, [normalizedPath]);

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
      <Link className={linkClass(memberHome)} href={memberHome}>
        {t('member.nav.basic')}
      </Link>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          className={linkClass(memberHome + '/orders')}
          aria-haspopup="menu"
          aria-expanded={ordersOpen}
          onClick={() => setOrdersOpen((open) => !open)}
        >
          <span>{t('member.nav.orders')}</span>
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 8L2 4h8L6 8z" fill="currentColor" />
          </svg>
        </button>
        {ordersOpen ? (
          <div
            className="absolute left-0 z-20 mt-1 min-w-[12rem] overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
            role="menu"
          >
            <Link
              className={[
                'block px-3 py-2 transition',
                normalizedPath === normalizePath(historyPath) || normalizedPath.startsWith(`${normalizePath(historyPath)}/`)
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600',
              ].join(' ')}
              href={historyPath}
              role="menuitem"
            >
              {t('member.nav.orders.history')}
            </Link>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

