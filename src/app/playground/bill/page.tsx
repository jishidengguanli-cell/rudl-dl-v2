'use client';

import { useMemo, useState } from 'react';
import { dictionaries, DEFAULT_LOCALE, type Locale } from '@/i18n/dictionary';

function makeT(localeParam?: string) {
  const l = (localeParam as Locale) && dictionaries[localeParam as Locale]
    ? (localeParam as Locale)
    : DEFAULT_LOCALE;
  const dict = dictionaries[l];
  return (key: string) => dict[key] ?? key;
}

export default function BillPlayground({
  params,
}: {
  params: { lang?: string };
}) {
  const t = useMemo(() => makeT(params?.lang), [params?.lang]);

  const [accountId, setAccountId] = useState('owner_1');
  const [linkId, setLinkId] = useState('link_1');
  const [platform, setPlatform] = useState<'apk' | 'ipa'>('apk');
  const [out, setOut] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOut('loading...');
    try {
      const res = await fetch('/api/dl/bill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, link_id: linkId, platform }),
      });
      const json = await res.json();
      setOut(JSON.stringify(json, null, 2));
    } catch (err: any) {
      setOut(String(err?.message ?? err));
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <h2 className="text-lg font-medium">{t('bill.title') ?? 'Billing test'}</h2>

      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <div className="mb-1">{t('bill.account') ?? 'Account ID'}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </label>

          <label className="text-sm">
            <div className="mb-1">{t('bill.link') ?? 'Link ID'}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
            />
          </label>

          <label className="text-sm">
            <div className="mb-1">{t('bill.platform') ?? 'Platform'}</div>
            <select
              className="w-full rounded border px-2 py-1"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as 'apk' | 'ipa')}
            >
              <option value="apk">apk</option>
              <option value="ipa">ipa</option>
            </select>
          </label>
        </div>

        <button className="rounded bg-black px-3 py-1 text-white">
          {t('bill.submit') ?? 'Submit'}
        </button>
      </form>

      <div>
        <div className="mb-1 text-sm font-medium">{t('result.label') ?? 'Result'}</div>
        <pre className="overflow-auto rounded bg-gray-100 p-3 text-xs whitespace-pre-wrap">
{out}
        </pre>
      </div>
    </div>
  );
}
