import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchTelegramSettings } from '@/lib/monitor';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type TelegramChat = {
  id: string;
  type: string | null;
  title: string | null;
  username: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type ChatSummary = {
  id: string;
  type: string | null;
  name: string;
  raw?: {
    title: string | null;
    username: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
};

const parseUid = (request: Request): string | null => {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  const value = pair.slice(4);
  return value || null;
};

const resolveDB = () => {
  const { env } = getRequestContext();
  const bindings = env as Env;
  return bindings.DB ?? bindings['rudl-app'];
};

const collectChat = (candidate: TelegramChat | null | undefined, map: Map<string, ChatSummary>) => {
  if (!candidate || typeof candidate.id === 'undefined' || candidate.id === null) return;
  const id = String(candidate.id);
  if (map.has(id)) return;
  const nameFromParts = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ').trim();
  const name = candidate.title?.trim() || candidate.username?.trim() || nameFromParts || `Chat ${id}`;
  map.set(id, {
    id,
    type: candidate.type ?? null,
    name,
    raw: {
      title: candidate.title ?? null,
      username: candidate.username ?? null,
      firstName: candidate.first_name ?? null,
      lastName: candidate.last_name ?? null,
    },
  });
};

const collectFromUpdate = (update: Record<string, unknown>, map: Map<string, ChatSummary>) => {
  if (!update || typeof update !== 'object') return;
  const possibleChats: Array<TelegramChat | null | undefined> = [];
  const maybe = (update as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (maybe && typeof maybe === 'object') {
    possibleChats.push(maybe.chat as TelegramChat);
  }
  const editedMessage = (update as Record<string, unknown>).edited_message as Record<string, unknown> | undefined;
  if (editedMessage && typeof editedMessage === 'object') {
    possibleChats.push(editedMessage.chat as TelegramChat);
  }
  const channelPost = (update as Record<string, unknown>).channel_post as Record<string, unknown> | undefined;
  if (channelPost && typeof channelPost === 'object') {
    possibleChats.push(channelPost.chat as TelegramChat);
  }
  const editedChannelPost = (update as Record<string, unknown>).edited_channel_post as Record<string, unknown> | undefined;
  if (editedChannelPost && typeof editedChannelPost === 'object') {
    possibleChats.push(editedChannelPost.chat as TelegramChat);
  }
  const myChatMember = (update as Record<string, unknown>).my_chat_member as Record<string, unknown> | undefined;
  if (myChatMember && typeof myChatMember === 'object') {
    possibleChats.push(myChatMember.chat as TelegramChat);
  }
  const chatMember = (update as Record<string, unknown>).chat_member as Record<string, unknown> | undefined;
  if (chatMember && typeof chatMember === 'object') {
    possibleChats.push(chatMember.chat as TelegramChat);
  }
  const chatJoinRequest = (update as Record<string, unknown>).chat_join_request as Record<string, unknown> | undefined;
  if (chatJoinRequest && typeof chatJoinRequest === 'object') {
    possibleChats.push(chatJoinRequest.chat as TelegramChat);
  }
  const callbackQuery = (update as Record<string, unknown>).callback_query as Record<string, unknown> | undefined;
  if (callbackQuery && typeof callbackQuery === 'object') {
    const message = callbackQuery.message as Record<string, unknown> | undefined;
    if (message && typeof message === 'object') {
      possibleChats.push(message.chat as TelegramChat);
    }
  }
  for (const chat of possibleChats) {
    collectChat(chat, map);
  }
};

export async function POST(request: Request) {
  const uid = parseUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  try {
    const settings = await fetchTelegramSettings(DB, uid);
    const token = settings.telegramBotToken?.trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: 'MISSING_TOKEN' }, { status: 400 });
    }

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 100,
        timeout: 0,
        allowed_updates: [
          'message',
          'channel_post',
          'my_chat_member',
          'chat_member',
          'edited_message',
          'edited_channel_post',
          'callback_query',
          'chat_join_request',
        ],
      }),
    });

    if (!telegramResponse.ok) {
      const snippet = await telegramResponse
        .clone()
        .text()
        .then((text) => text.slice(0, 500))
        .catch(() => '');
      return NextResponse.json(
        { ok: false, error: `TELEGRAM_HTTP_${telegramResponse.status}`, detail: snippet },
        { status: 502 }
      );
    }

    const payload = (await telegramResponse.json().catch(() => null)) as
      | { ok: boolean; result?: unknown }
      | null;

    if (!payload?.ok || !Array.isArray(payload.result)) {
      return NextResponse.json(
        { ok: false, error: 'TELEGRAM_RESPONSE_INVALID' },
        { status: 502 }
      );
    }

    const chatMap = new Map<string, ChatSummary>();
    for (const update of payload.result) {
      if (!update || typeof update !== 'object') continue;
      collectFromUpdate(update as Record<string, unknown>, chatMap);
    }

    const chats = Array.from(chatMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      chats,
      meta: {
        updates: payload.result.length,
        collected: chats.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
