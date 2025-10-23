import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo, hasColumn } from './distribution';

export type MemberRecord = {
  id: string;
  email: string | null;
  role: string | null;
  balance: number | null;
  createdAt: number;
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toEpochSeconds = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
};

export async function fetchMembers(DB: D1Database): Promise<MemberRecord[]> {
  const usersInfo = await getTableInfo(DB, 'users');
  const selectColumns = [
    'id',
    hasColumn(usersInfo, 'email') ? 'email' : null,
    hasColumn(usersInfo, 'role') ? 'role' : null,
    hasColumn(usersInfo, 'balance') ? 'balance' : null,
    hasColumn(usersInfo, 'created_at') ? 'created_at' : null,
  ].filter((column): column is string => Boolean(column));

  if (!selectColumns.includes('id')) return [];

  const orderParts: string[] = [];
  if (hasColumn(usersInfo, 'created_at')) orderParts.push('created_at DESC');
  if (hasColumn(usersInfo, 'email')) orderParts.push('email ASC');
  const orderClause = orderParts.length ? ` ORDER BY ${orderParts.join(', ')}` : '';
  const query = `SELECT ${selectColumns.join(', ')} FROM users${orderClause}`;
  const result = await DB.prepare(query).all();
  const rows = (result.results as Record<string, unknown>[] | undefined) ?? [];

  return rows.map((row) => ({
    id: toStringOrNull(row.id) ?? '',
    email: toStringOrNull(row.email),
    role: toStringOrNull(row.role),
    balance: toNumberOrNull(row.balance),
    createdAt: toEpochSeconds((row as Record<string, unknown>).created_at),
  }));
}
