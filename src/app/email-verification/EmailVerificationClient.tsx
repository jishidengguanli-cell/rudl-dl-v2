'use client';

import { useEffect, useMemo, useState } from 'react';

type StatusKey = 'success' | 'expired' | 'invalid' | 'error';
type Variant = 'success' | 'info' | 'warning' | 'error';

type TextBundle = {
  title: string;
  pendingSubtitle: string;
  successSubtitle: string;
  emailLabel: string;
  emailMissing: string;
  statusLabel: string;
  statusPending: string;
  statusVerified: string;
  resendCta: string;
  resendSending: string;
  resendHelp: string;
  resendCooldown: string;
  resendReady: string;
  resendSuccess: string;
  resendError: string;
  resendRequiresEmail: string;
  resendAlreadyVerified: string;
  cooldownActive: string;
  countdownLabel: string;
  pendingHint: string;
  successRedirectNote: string;
  successRedirectCta: string;
  successCountdownLabel: string;
  statusMessages: Partial<Record<StatusKey, string>>;
};

type Props = {
  email: string | null;
  isVerified: boolean;
  initialStatus: StatusKey | null;
  initialCountdown: number;
  dashboardHref: string;
  texts: TextBundle;
  autoRedirectSeconds: number;
};

const variantClassName = (variant: Variant) => {
  switch (variant) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-800';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-800';
  }
};

const statusToVariant = (status: StatusKey): Variant => {
  if (status === 'success') return 'success';
  if (status === 'expired') return 'warning';
  if (status === 'invalid') return 'error';
  return 'error';
};

const formatDuration = (value: number): string => {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export default function EmailVerificationClient({
  email,
  isVerified,
  initialStatus,
  initialCountdown,
  dashboardHref,
  texts,
  autoRedirectSeconds,
}: Props) {
  const [verified, setVerified] = useState(isVerified);
  const [alert, setAlert] = useState<string | null>(() =>
    initialStatus ? texts.statusMessages[initialStatus] ?? null : null
  );
  const [alertVariant, setAlertVariant] = useState<Variant>(() =>
    initialStatus ? statusToVariant(initialStatus) : 'info'
  );
  const [countdown, setCountdown] = useState(() => Math.max(0, Math.floor(initialCountdown)));
  const [loading, setLoading] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(
    isVerified ? autoRedirectSeconds : null
  );

  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdown]);

  useEffect(() => {
    if (!verified) return;
    setRedirectCountdown((prev) => (prev === null ? autoRedirectSeconds : prev));
  }, [verified, autoRedirectSeconds]);

  useEffect(() => {
    if (!verified || redirectCountdown === null) return;
    if (redirectCountdown <= 0) {
      window.location.href = dashboardHref;
      return;
    }
    const timer = window.setTimeout(() => {
      setRedirectCountdown((prev) => (prev === null ? null : prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [verified, redirectCountdown, dashboardHref]);

  const onResend = async () => {
    if (!email) {
      setAlert(texts.resendRequiresEmail);
      setAlertVariant('error');
      return;
    }
    if (verified) {
      setAlert(texts.resendAlreadyVerified);
      setAlertVariant('success');
      return;
    }
    if (countdown > 0 || loading) return;

    try {
      setLoading(true);
      setAlert(null);

      const response = await fetch('/api/member/email/send-verification', {
        method: 'POST',
      });
      const data = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            alreadyVerified?: boolean;
            error?: string;
            nextAllowedAt?: number;
            serverTime?: number;
            retryAfter?: number;
          }
        | null;

      if (data?.alreadyVerified) {
        setVerified(true);
        setAlert(texts.resendAlreadyVerified);
        setAlertVariant('success');
        setCountdown(0);
        return;
      }

      if (!response.ok || !data?.ok) {
        if (response.status === 429) {
          const serverTime =
            typeof data?.serverTime === 'number' ? data.serverTime : Math.floor(Date.now() / 1000);
          const retrySeconds =
            typeof data?.retryAfter === 'number'
              ? Math.max(0, Math.floor(data.retryAfter))
              : Math.max(0, (data?.nextAllowedAt ?? serverTime) - serverTime);
          setCountdown(retrySeconds);
          setAlert(texts.cooldownActive);
          setAlertVariant('warning');
          return;
        }
        const message =
          data?.error && typeof data.error === 'string'
            ? `${texts.resendError} (${data.error})`
            : texts.resendError;
        setAlert(message);
        setAlertVariant('error');
        return;
      }

      const serverTime =
        typeof data.serverTime === 'number' ? data.serverTime : Math.floor(Date.now() / 1000);
      const nextAllowedAt =
        typeof data.nextAllowedAt === 'number' ? data.nextAllowedAt : serverTime;
      setCountdown(Math.max(0, nextAllowedAt - serverTime));
      setAlert(texts.resendSuccess);
      setAlertVariant('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAlert(`${texts.resendError} (${message})`);
      setAlertVariant('error');
    } finally {
      setLoading(false);
    }
  };

  const subtitle = useMemo(
    () => (verified ? texts.successSubtitle : texts.pendingSubtitle),
    [verified, texts.pendingSubtitle, texts.successSubtitle]
  );

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm shadow-black/5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{texts.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{subtitle}</p>
      </div>

      {alert && (
        <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${variantClassName(alertVariant)}`}>
          {alert}
        </div>
      )}

      <dl className="mt-6 space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div>
          <dt className="text-sm font-medium text-neutral-500">{texts.emailLabel}</dt>
          <dd className="mt-1 text-base text-neutral-900">
            {email ? email : <span className="font-semibold text-amber-600">{texts.emailMissing}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-neutral-500">{texts.statusLabel}</dt>
          <dd className="mt-1 text-base">
            {verified ? (
              <span className="font-semibold text-emerald-600">{texts.statusVerified}</span>
            ) : (
              <span className="font-medium text-amber-600">{texts.statusPending}</span>
            )}
          </dd>
        </div>
      </dl>

      {!verified && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-neutral-600">{texts.pendingHint}</p>
          <button
            type="button"
            onClick={onResend}
            disabled={!email || countdown > 0 || loading}
            className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? texts.resendSending : texts.resendCta}
          </button>
          <p className="text-sm text-neutral-500">{texts.resendHelp}</p>
          <p className="text-xs text-neutral-500">
            {countdown > 0 ? (
              <>
                {texts.countdownLabel}:{' '}
                <span className="font-medium text-neutral-900">{formatDuration(countdown)}</span>
              </>
            ) : (
              <span className="font-medium text-emerald-600">{texts.resendReady}</span>
            )}
          </p>
          <p className="text-xs text-neutral-500">{texts.resendCooldown}</p>
        </div>
      )}

      {verified && (
        <div className="mt-6 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <p className="text-sm">{texts.successRedirectNote}</p>
          {redirectCountdown !== null && (
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {texts.successCountdownLabel}: {formatDuration(redirectCountdown)}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              window.location.href = dashboardHref;
            }}
            className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-500"
          >
            {texts.successRedirectCta}
          </button>
        </div>
      )}
    </section>
  );
}
