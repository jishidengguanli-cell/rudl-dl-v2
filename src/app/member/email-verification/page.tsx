import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';
import { fetchMemberById } from '@/lib/members';
import EmailVerificationClient from './EmailVerificationClient';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type PageProps = {
  searchParams?: {
    status?: string;
  };
};

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

const resolveLocale = (langCookie: string | undefined, localeCookie: string | undefined): Locale => {
  if (isLocale(langCookie)) return langCookie;
  if (isLocale(localeCookie)) return localeCookie;
  return DEFAULT_LOCALE;
};

const normalizeStatus = (
  value: string | null | undefined
): 'success' | 'expired' | 'invalid' | 'error' | null => {
  if (!value) return null;
  const key = value.toLowerCase();
  if (key === 'success' || key === 'expired' || key === 'invalid' || key === 'error') {
    return key;
  }
  return null;
};

export default async function MemberEmailVerificationPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value ?? null;
  const langCookie = cookieStore.get('lang')?.value;
  const localeCookie = cookieStore.get('locale')?.value;
  const locale = resolveLocale(langCookie, localeCookie);
  const t = getTranslator(locale);

  if (!uid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('member.basic.notFound')}
      </div>
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const member = await fetchMemberById(DB, uid);
  if (!member) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('member.basic.notFound')}
      </div>
    );
  }

  const initialStatus = normalizeStatus(searchParams?.status);

  const texts = {
    title: t('member.emailVerification.title'),
    description: t('member.emailVerification.description'),
    emailLabel: t('member.emailVerification.emailLabel'),
    emailMissing: t('member.emailVerification.emailMissing'),
    statusLabel: t('member.emailVerification.status.label'),
    statusVerified: t('member.emailVerification.status.verified'),
    statusPending: t('member.emailVerification.status.pending'),
    buttonStart: t('member.emailVerification.button.start'),
    buttonSending: t('member.emailVerification.button.sending'),
    sentNotice: t('member.emailVerification.sentNotice'),
    sentHint: t('member.emailVerification.sentHint'),
    genericError: t('member.emailVerification.error.generic'),
    alreadyVerified: t('member.emailVerification.error.alreadyVerified'),
    requiresEmail: t('member.emailVerification.error.emailMissing'),
    statusMessages: {
      success: t('member.emailVerification.statusMessage.success'),
      expired: t('member.emailVerification.statusMessage.expired'),
      invalid: t('member.emailVerification.statusMessage.invalid'),
      error: t('member.emailVerification.statusMessage.error'),
    },
  };

  return (
    <EmailVerificationClient
      email={member.email ?? null}
      isVerified={member.isEmailVerified}
      initialStatus={initialStatus}
      texts={texts}
    />
  );
}
