'use client';

import { useEffect, useState } from 'react';

const API = 'https://api.dataruapp.com';

type MeResp =
  | { ok: true; user: { id: string; email: string; created_at: number }; balance: number }
  | { ok: false };

export default function Dashboard() {
  const [data, setData] = useState<MeResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/auth/me`, { credentials: 'include' });
        const j = (await r.json()) as MeResp;
        if (alive) setData(j);
      } catch {
        if (alive) setData({ ok: false } as MeResp);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <p>載入中…</p>;

  if (!data?.ok) {
    return (
      <div>
        <p>請先登入。</p>
        <a className="btn" href="/login">Go Login</a>
      </div>
    );
  }

  const { user, balance } = data;
  return (
    <div>
      <h2>Dashboard</h2>
      <p>Hi, {user.email}</p>
      <p>Point balance: {balance}</p>
      <a
        className="btn"
        href={`${API}/auth/logout`}
        onClick={async (e) => {
          e.preventDefault();
          await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
          location.href = '/login';
        }}
      >
        登出
      </a>
    </div>
  );
}
