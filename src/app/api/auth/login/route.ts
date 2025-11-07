import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { decodePasswordRecord, hashPassword } from '@/lib/pw';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const COOKIE_LOCALE_KEYS = ['lang', 'locale'];

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

const normalizeAcceptLanguage = (value: string): Locale | null => {
  const tokens = value.split(',').map((entry) => entry.trim());
  for (const token of tokens) {
    const [langPart] = token.split(';');
    if (!langPart) continue;
    const lower = langPart.toLowerCase();
    if (lower.includes('zh-hant') || lower.includes('zh-tw') || lower.includes('zh-hk')) return 'zh-TW';
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
    if (lower.startsWith('ru')) return 'ru';
    if (lower.startsWith('vi')) return 'vi';
  }
  return null;
};

const parseLocale = (req: Request): Locale => {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const key of COOKIE_LOCALE_KEYS) {
    const entry = cookies.find((part) => part.startsWith(`${key}=`));
    if (entry) {
      const value = entry.slice(key.length + 1);
      if (isLocale(value)) return value;
    }
  }
  const acceptLanguage = req.headers.get('accept-language');
  if (acceptLanguage) {
    const locale = normalizeAcceptLanguage(acceptLanguage);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
};

const invalidMessages: Record<Locale, string> = {
  en: 'Account or password not found',
  'zh-TW': '帳號或密碼不存在',
  'zh-CN': '账号或密码不存在',
  ru: 'Аккаунт или пароль не найдены',
  vi: 'Không tìm thấy tài khoản hoặc mật khẩu',
};

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{ email: unknown; password: unknown }>;
  const email = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!email || !password) return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });

  try {
    const locale = parseLocale(req);
    const invalidMessage = invalidMessages[locale] ?? invalidMessages.en;

    const user = await DB.prepare('SELECT id, pw_hash FROM users WHERE email=? LIMIT 1')
      .bind(email)
      .first<{ id: string; pw_hash: string }>();

    if (!user) return NextResponse.json({ ok: false, error: invalidMessage }, { status: 401 });

    const parsed = decodePasswordRecord(user.pw_hash);
    if (!parsed?.saltHex) return NextResponse.json({ ok: false, error: invalidMessage }, { status: 401 });

    const derived = await hashPassword(password, parsed.saltHex);
    if (derived !== parsed.hashHex) return NextResponse.json({ ok: false, error: invalidMessage }, { status: 401 });

    const res = NextResponse.json({ ok: true, user_id: user.id });
    res.cookies.set('uid', user.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

