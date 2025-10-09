'use client';
export const runtime = 'edge';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';

export default function RechargePage() {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [memo, setMemo] = useState('');
  const [out, setOut] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOut('loading...');
    try {
      const r = await fetch('/api/recharge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, amount: Number(amount), memo }),
      });
      const json: unknown = await r.json();
      if (typeof json === 'object' && json !== null && 'ok' in json && typeof (json as { ok: unknown }).ok === 'boolean') {
        const payload = json as { ok: boolean; amount?: unknown; error?: unknown };
        if (payload.ok) {
          const amountStr =
            typeof payload.amount === 'number'
              ? payload.amount
              : Number.isFinite(Number(payload.amount))
              ? Number(payload.amount)
              : null;
          const formatted = amountStr !== null ? `+${amountStr}` : '';
          setOut(`${t('recharge.success') ?? 'Recharge success'}${formatted ? `: ${formatted}` : ''}`);
          return;
        }
        const message = typeof payload.error === 'string' ? payload.error : 'Recharge failed';
        setOut(message);
        return;
      }
      setOut('Unexpected response');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setOut(message);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-lg border bg-white p-6 space-y-4">
      <h2 className="text-lg font-medium">{t('recharge.title') ?? 'Recharge'}</h2>
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <div className="mb-1">{t('recharge.account') ?? 'Account ID'}</div>
          <input className="w-full rounded border px-2 py-1" value={accountId} onChange={e=>setAccountId(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('recharge.amount') ?? 'Amount'}</div>
          <input className="w-full rounded border px-2 py-1" type="number" min={1} value={amount} onChange={e=>setAmount(Number(e.target.value))} required />
        </label>
        <label className="block text-sm">
          <div className="mb-1">{t('recharge.memo') ?? 'Memo'}</div>
          <input className="w-full rounded border px-2 py-1" value={memo} onChange={e=>setMemo(e.target.value)} />
        </label>
        <button className="rounded bg-black px-3 py-1 text-white" type="submit">
          {t('recharge.submit') ?? 'Top up'}
        </button>
      </form>
      {out && <pre className="rounded bg-gray-100 p-3 text-xs whitespace-pre-wrap">{out}</pre>}
    </div>
  );
}
