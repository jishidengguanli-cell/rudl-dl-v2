import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('uid', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
