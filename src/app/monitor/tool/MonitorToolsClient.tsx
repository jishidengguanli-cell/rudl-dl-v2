'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';

type ChatSummary = {
  id: string;
  name: string;
  type: string | null;
};

type Meta = {
  updates?: number;
  collected?: number;
};

type Props = {
  hasBotToken: boolean;
};

export default function MonitorToolsClient({ hasBotToken }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);

  const fetchChats = async () => {
    setLoading(true);
    setError(null);
    setMeta(null);

    try {
      const response = await fetch('/api/monitor/tools/chats', { method: 'POST' });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; chats: ChatSummary[]; meta?: Meta }
        | { ok: false; error?: string }
        | null;

      if (!response.ok || !data || !('ok' in data) || !data.ok) {
        const detail = (data && 'error' in data && data.error) || t('monitor.tools.error');
        throw new Error(detail);
      }

      setChats(Array.isArray(data.chats) ? data.chats : []);
      setMeta(data.meta ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('monitor.tools.error');
      setError(message);
      setChats([]);
    } finally {
      setLoading(false);
    }
  };

  if (!hasBotToken) {
    return (
      <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
        {t('monitor.tools.missingToken')}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <button
        type="button"
        onClick={fetchChats}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? t('monitor.tools.fetching') : t('monitor.tools.fetchButton')}
      </button>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {meta ? (
        <p className="text-sm text-gray-500">
          {t('monitor.tools.meta')
            .replace('{chats}', String(meta.collected ?? chats.length))
            .replace('{updates}', String(meta.updates ?? 0))}
        </p>
      ) : null}

      <div className="rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
          {t('monitor.tools.resultTitle')}
        </div>
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-500">{t('status.loading')}</div>
          ) : chats.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">
              {t('monitor.tools.resultEmpty')}
            </div>
          ) : (
            chats.map((chat) => (
              <div key={chat.id} className="px-4 py-4">
                <div className="text-sm font-semibold text-gray-900">{chat.name}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {t('monitor.tools.chatId')}:{' '}
                  <span className="font-mono text-gray-800">{chat.id}</span>
                </div>
                {chat.type ? (
                  <div className="text-xs text-gray-500">
                    {t('monitor.tools.chatType')}: {chat.type}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
