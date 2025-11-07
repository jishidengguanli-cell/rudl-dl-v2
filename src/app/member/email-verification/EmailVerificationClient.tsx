'use client';

import { useState } from 'react';

type StatusKey = 'success' | 'expired' | 'invalid' | 'error';

type TextBundle = {
  title: string;
  description: string;
  emailLabel: string;
  emailMissing: string;
  statusLabel: string;
  statusVerified: string;
  statusPending: string;
  buttonStart: string;
  buttonSending: string;
  sentNotice: string;
  sentHint: string;
  genericError: string;
  alreadyVerified: string;
  requiresEmail: string;
  statusMessages: Partial<Record<StatusKey, string>>;
};

type Props = {
  email: string | null;
  isVerified: boolean;
  initialStatus: StatusKey | null;
  texts: TextBundle;
};

const statusVariant = (key: StatusKey | 'success' | 'info' | 'warning' | 'error') => {
  switch (key) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'info':
      return 'border-sky-200 bg-sky-50 text-sky-800';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-800';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-800';
  }
};

export default function EmailVerificationClient({
  email,
  isVerified,
  initialStatus,
  texts,
}: Props) {
  const [verified, setVerified] = useState(isVerified);
  const [alert, setAlert] = useState<string | null>(() => {
    if (!initialStatus) return null;
    return texts.statusMessages[initialStatus] ?? null;
  });
  const [alertVariant, setAlertVariant] = useState<'success' | 'info' | 'warning' | 'error'>(() => {
    if (initialStatus) {
      if (initialStatus === 'success') return 'success';
      if (initialStatus === 'expired') return 'warning';
      if (initialStatus === 'invalid') return 'error';
      return 'error';
    }
    return 'info';
  });
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'pending'>('idle');
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleSend = async () => {
    if (!email) {
      setAlert(texts.requiresEmail);
      setAlertVariant('error');
      return;
    }
    if (verified) {
      setAlert(texts.alreadyVerified);
      setAlertVariant('success');
      return;
    }

    try {
      setLoading(true);
      setAlert(null);

      const response = await fetch('/api/member/email/send-verification', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      });

      const data = (await response.json().catch(() => ({}))) as
        | { ok?: boolean; alreadyVerified?: boolean; error?: string }
        | undefined;

      if (!response.ok || !data?.ok) {
        if (data?.alreadyVerified) {
          setVerified(true);
          setAlert(texts.alreadyVerified);
          setAlertVariant('success');
          return;
        }
        setAlert(data?.error ? `${texts.genericError} (${data.error})` : texts.genericError);
        setAlertVariant('error');
        return;
      }

      setAlert(`${texts.sentNotice} ${texts.sentHint}`.trim());
      setAlertVariant('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAlert(`${texts.genericError} (${message})`);
      setAlertVariant('error');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTestStatus('pending');
    setTestResult(null);
    try {
      const response = await fetch('/api/debug/mailchannels', { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as
        | {
            ok?: boolean;
            viaBindings?: boolean;
            viaProcessEnv?: boolean;
            hasFromAddress?: boolean;
            apiBase?: string;
            message?: string;
          }
        | undefined;
      if (!response.ok || !data) {
        throw new Error(data?.message ?? 'Unknown response');
      }
      if (!data.ok) {
        throw new Error(data.message ?? 'MAILCHANNELS_API_KEY missing');
      }
      setTestResult(
        `MailChannels key detected (bindings: ${Boolean(data.viaBindings)}, process.env: ${Boolean(
          data.viaProcessEnv
        )}, from address: ${Boolean(data.hasFromAddress)}, apiBase: ${data.apiBase ?? 'n/a'})`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult(`Test failed: ${message}`);
    } finally {
      setTestStatus('idle');
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{texts.title}</h2>
        <p className="mt-1 text-sm text-gray-600">{texts.description}</p>
      </div>

      {alert && (
        <div
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusVariant(alertVariant)}`}
        >
          {alert}
        </div>
      )}

      <dl className="mt-6 space-y-4">
        <div>
          <dt className="text-sm font-medium text-gray-500">{texts.emailLabel}</dt>
          <dd className="mt-1 text-base text-gray-900">
            {email ? (
              email
            ) : (
              <span className="font-medium text-amber-600">{texts.emailMissing}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">{texts.statusLabel}</dt>
          <dd className="mt-1 text-base text-gray-900">
            {verified ? (
              <span className="font-semibold text-emerald-600">{texts.statusVerified}</span>
            ) : (
              <span className="font-medium text-amber-600">{texts.statusPending}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || verified || !email}
          className="inline-flex items-center rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? texts.buttonSending : texts.buttonStart}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testStatus === 'pending'}
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {testStatus === 'pending' ? 'Testing…' : 'Test API key'}
        </button>
      </div>
      {testResult ? (
        <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
          {testResult}
        </p>
      ) : null}
    </section>
  );
}
