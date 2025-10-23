import type { D1Database } from '@cloudflare/workers-types';

export type AdminUserRecord = {
  id: string;
  email: string | null;
  role: string | null;
};

export async function fetchUserById(DB: D1Database | undefined, uid: string | undefined): Promise<AdminUserRecord | null> {
  if (!DB || !uid) return null;
  const row = await DB.prepare('SELECT id, email, role FROM users WHERE id=? LIMIT 1')
    .bind(uid)
    .first<{ id: string; email?: string | null; role?: string | null }>()
    .catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email ?? null,
    role: row.role ?? null,
  };
}

export async function fetchAdminUser(DB: D1Database | undefined, uid: string | undefined): Promise<AdminUserRecord | null> {
  const user = await fetchUserById(DB, uid);
  if (!user) return null;
  if ((user.role ?? '').toLowerCase() !== 'admin') {
    return null;
  }
  return user;
}
