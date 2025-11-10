import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';
import {
  EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS,
  getVerificationSummary,
} from '@/lib/email-verification';
import EmailVerificationClient from './EmailVerificationClient';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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

export default async function EmailVerificationPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value ?? null;
  const langCookie = cookieStore.get('lang')?.value;
  const localeCookie = cookieStore.get('locale')?.value;
  const locale = resolveLocale(langCookie, localeCookie);
  const t = getTranslator(locale);
  const localePrefix = `/${locale}`;

  if (!uid) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="text-lg font-semibold">{t('emailVerification.title')}</h2>
          <p className="mt-2 text-sm">{t('emailVerification.unauthenticated')}</p>
        </section>
      </div>
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const summary = await getVerificationSummary(DB, uid);
  if (!summary) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
          <h2 className="text-lg font-semibold">{t('emailVerification.title')}</h2>
          <p className="mt-2 text-sm">{t('emailVerification.notFound')}</p>
        </section>
      </div>
    );
  }

  const resolvedSearchParams = (searchParams
    ? await searchParams
    : {}) as Record<string, string | string[] | undefined>;
  const rawStatus = resolvedSearchParams?.status;
  const statusValue = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus ?? null;
  const initialStatus = normalizeStatus(statusValue);

  const serverTime = Math.floor(Date.now() / 1000);
  const nextAllowedAt = summary.nextAllowedAt ?? null;
  const initialCountdown = nextAllowedAt ? Math.max(0, nextAllowedAt - serverTime) : 0;
  const resendMinutes = Math.max(1, Math.round(EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS / 60));

  const texts = {
    title: t('emailVerification.title'),
    pendingSubtitle: t('emailVerification.subtitle.pending'),
    successSubtitle: t('emailVerification.subtitle.success'),
    emailLabel: t('emailVerification.emailLabel'),
    emailMissing: t('emailVerification.emailMissing'),
    statusLabel: t('emailVerification.statusLabel'),
    statusPending: t('emailVerification.status.pending'),
    statusVerified: t('emailVerification.status.verified'),
    resendCta: t('emailVerification.resend'),
    resendSending: t('emailVerification.resendSending'),
    resendHelp: t('emailVerification.resendHelp'),
    resendCooldown: t('emailVerification.resendCooldown').replace(
      '{minutes}',
      String(resendMinutes)
    ),
    resendReady: t('emailVerification.resendReady'),
    resendSuccess: t('emailVerification.resendSuccess'),
    resendError: t('emailVerification.resendError'),
    resendRequiresEmail: t('emailVerification.resendRequiresEmail'),
    resendAlreadyVerified: t('emailVerification.resendAlreadyVerified'),
    cooldownActive: t('emailVerification.cooldownActive'),
    countdownLabel: t('emailVerification.countdownLabel'),
    successCountdownLabel: t('emailVerification.successCountdownLabel'),
    pendingHint: t('emailVerification.pendingHint'),
    successRedirectNote: t('emailVerification.successRedirectNote'),
    successRedirectCta: t('emailVerification.successRedirectCta'),
    statusMessages: {
      success: t('emailVerification.message.success'),
      expired: t('emailVerification.message.expired'),
      invalid: t('emailVerification.message.invalid'),
      error: t('emailVerification.message.error'),
    },
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <EmailVerificationClient
        email={summary.email}
        isVerified={summary.isVerified || initialStatus === 'success'}
        initialStatus={initialStatus}
        initialCountdown={initialCountdown}
        dashboardHref={`${localePrefix}/dashboard`}
        texts={texts}
        autoRedirectSeconds={5}
      />
    </div>
  );
}
