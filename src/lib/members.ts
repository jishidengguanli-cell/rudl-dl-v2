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

const buildSelectColumns = async (DB: D1Database) => {
  const usersInfo = await getTableInfo(DB, 'users');
  const selectColumns = [
    'id',
    hasColumn(usersInfo, 'email') ? 'email' : null,
    hasColumn(usersInfo, 'role') ? 'role' : null,
    hasColumn(usersInfo, 'balance') ? 'balance' : null,
    hasColumn(usersInfo, 'created_at') ? 'created_at' : null,
  ].filter((column): column is string => Boolean(column));
  return { selectColumns, usersInfo };
};

const mapMemberRow = (row: Record<string, unknown>): MemberRecord => {
  const emailValue = 'email' in row ? (row as Record<string, unknown>).email : null;
  const roleValue = 'role' in row ? (row as Record<string, unknown>).role : null;
  const balanceValue = 'balance' in row ? (row as Record<string, unknown>).balance : null;
  const createdAtValue = 'created_at' in row ? (row as Record<string, unknown>).created_at : null;
  return {
    id: toStringOrNull(row.id) ?? '',
    email: toStringOrNull(emailValue),
    role: toStringOrNull(roleValue),
    balance: toNumberOrNull(balanceValue),
    createdAt: toEpochSeconds(createdAtValue),
  };
};

export async function fetchMembers(DB: D1Database): Promise<MemberRecord[]> {
  const { selectColumns, usersInfo } = await buildSelectColumns(DB);
  if (!selectColumns.includes('id')) return [];

  const orderParts: string[] = [];
  if (hasColumn(usersInfo, 'created_at')) orderParts.push('created_at DESC');
  if (hasColumn(usersInfo, 'email')) orderParts.push('email ASC');
  const orderClause = orderParts.length ? ` ORDER BY ${orderParts.join(', ')}` : '';
  const query = `SELECT ${selectColumns.join(', ')} FROM users${orderClause}`;
  const result = await DB.prepare(query).all();
  const rows = (result.results as Record<string, unknown>[] | undefined) ?? [];

  return rows.map((row) => mapMemberRow(row as Record<string, unknown>));
}

export async function fetchMemberById(DB: D1Database, memberId: string): Promise<MemberRecord | null> {
  const { selectColumns } = await buildSelectColumns(DB);
  if (!selectColumns.includes('id')) return null;
  const query = `SELECT ${selectColumns.join(', ')} FROM users WHERE id=? LIMIT 1`;
  const row = await DB.prepare(query)
    .bind(memberId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return mapMemberRow(row);
}
