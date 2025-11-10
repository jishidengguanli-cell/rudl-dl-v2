import { redirect } from 'next/navigation';
import type { D1Database } from '@cloudflare/workers-types';
import type { Locale } from '@/i18n/dictionary';
import { getVerificationSummary } from '@/lib/email-verification';

type RequireVerifiedUserParams = {
  DB: D1Database;
  uid: string;
  locale: Locale;
  currentPath?: string | null;
  loginRedirect: string;
};

const sanitizePath = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
};

export async function requireVerifiedUser({
  DB,
  uid,
  locale,
  currentPath,
  loginRedirect,
}: RequireVerifiedUserParams) {
  const summary = await getVerificationSummary(DB, uid);
  if (!summary) {
    redirect(loginRedirect);
  }
  if (!summary.isVerified) {
    const localePrefix = `/${locale}`;
    const query = new URLSearchParams({ status: 'required' });
    const safePath = sanitizePath(currentPath);
    if (
      safePath &&
      safePath !== `${localePrefix}/email-verification` &&
      safePath !== '/email-verification'
    ) {
      query.set('next', safePath);
    }
    redirect(`${localePrefix}/email-verification?${query.toString()}`);
  }
  return summary;
}
