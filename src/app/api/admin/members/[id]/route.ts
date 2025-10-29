import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { fetchAdminUser } from '@/lib/admin';
import { ensurePointTables, hasUsersBalanceColumn } from '@/lib/schema';
import { getStatsTableName } from '@/lib/downloads';

export const runtime = 'edge';

type EnvBindings = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
};

type RouteParams = { id: string };

const jsonError = (error: string, status = 400) =>
  NextResponse.json({ ok: false, error }, { status });

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

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export async function PATCH(request: Request, context: { params: Promise<RouteParams> }) {
  const { id } = await context.params;
  const memberId = (id ?? '').trim();
  if (!memberId) {
    return jsonError('INVALID_MEMBER_ID', 400);
  }

  const uid = parseUid(request);
  if (!uid) {
    return jsonError('UNAUTHENTICATED', 401);
  }

  const { env } = getRequestContext();
  const bindings = env as EnvBindings;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return jsonError('D1_NOT_AVAILABLE', 500);
  }

  const adminUser = await fetchAdminUser(DB, uid);
  if (!adminUser) {
    return jsonError('FORBIDDEN', 403);
  }

  await ensurePointTables(DB);

  let payload: Partial<{
    role: unknown;
    setBalance: unknown;
    adjustBalance: unknown;
  }>;
  try {
    payload = (await request.json()) as Partial<{
      role: unknown;
      setBalance: unknown;
      adjustBalance: unknown;
    }>;
  } catch {
    return jsonError('INVALID_PAYLOAD', 400);
  }

  const nextRoleRaw = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : null;
  const nextRole = nextRoleRaw === 'admin' || nextRoleRaw === 'user' ? nextRoleRaw : null;
  const setBalanceValue = toNumberOrNull(payload.setBalance);
  const adjustBalanceValue = toNumberOrNull(payload.adjustBalance);

  try {
    const userRow = await DB.prepare('SELECT id, email, role FROM users WHERE id=? LIMIT 1')
      .bind(memberId)
      .first<{ id: string; email?: string | null; role?: string | null }>();
    if (!userRow) {
      return jsonError('NOT_FOUND', 404);
    }

    const hasBalanceColumn = await hasUsersBalanceColumn(DB);
    let currentBalance = 0;
    if (hasBalanceColumn) {
      const balanceRow = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
        .bind(memberId)
        .first<{ balance?: number | null }>();
      currentBalance = Number(balanceRow?.balance ?? 0);
    } else {
      const legacyRow = await DB.prepare('SELECT balance FROM point_accounts WHERE id=? LIMIT 1')
        .bind(memberId)
        .first<{ balance?: number | null }>()
        .catch(() => null);
      currentBalance = legacyRow ? Number(legacyRow.balance ?? 0) : 0;
    }

    let workingBalance = currentBalance;
    const ledgerEntries: Array<{ delta: number; reason: string }> = [];

    if (setBalanceValue !== null) {
      const delta = setBalanceValue - workingBalance;
      if (Number.isFinite(delta) && delta !== 0) {
        ledgerEntries.push({ delta, reason: 'admin:set' });
      }
      workingBalance = setBalanceValue;
    }

    if (adjustBalanceValue !== null && adjustBalanceValue !== 0) {
      workingBalance += adjustBalanceValue;
      if (Number.isFinite(adjustBalanceValue) && adjustBalanceValue !== 0) {
        ledgerEntries.push({ delta: adjustBalanceValue, reason: 'admin:adjust' });
      }
    }

    const updates: Array<Promise<unknown>> = [];
    const now = Math.floor(Date.now() / 1000);

    if (nextRole && nextRole !== (userRow.role ?? '').toLowerCase()) {
      updates.push(DB.prepare('UPDATE users SET role=? WHERE id=?').bind(nextRole, memberId).run());
    }

    if (workingBalance !== currentBalance) {
      if (hasBalanceColumn) {
        updates.push(DB.prepare('UPDATE users SET balance=? WHERE id=?').bind(workingBalance, memberId).run());
      } else {
        updates.push(
          DB.prepare('INSERT OR IGNORE INTO point_accounts (id, balance, updated_at) VALUES (?, ?, ?)')
            .bind(memberId, 0, now)
            .run()
            .catch(() => undefined)
        );
        updates.push(
          DB.prepare('UPDATE point_accounts SET balance=?, updated_at=? WHERE id=?')
            .bind(workingBalance, now, memberId)
            .run()
        );
      }
    }

    if (ledgerEntries.length) {
      await Promise.all(
        ledgerEntries.map(async ({ delta, reason }) => {
          const ledgerId = crypto.randomUUID();
          await DB.prepare(
            `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
             VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
          )
            .bind(ledgerId, memberId, delta, reason, now)
            .run()
            .catch(() => undefined);
        })
      );
    }

    if (updates.length) {
      await Promise.all(updates);
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: memberId,
        role: nextRole ?? userRow.role ?? null,
        balance: workingBalance,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message || 'UPDATE_FAILED', 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<RouteParams> }) {
  const { id } = await context.params;
  const memberId = (id ?? '').trim();
  if (!memberId) {
    return jsonError('INVALID_MEMBER_ID', 400);
  }

  const uid = parseUid(request);
  if (!uid) {
    return jsonError('UNAUTHENTICATED', 401);
  }

  const { env } = getRequestContext();
  const bindings = env as EnvBindings;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const R2 = bindings.R2_BUCKET;
  if (!DB || !R2) {
    return jsonError('MISSING_BINDINGS', 500);
  }

  const adminUser = await fetchAdminUser(DB, uid);
  if (!adminUser) {
    return jsonError('FORBIDDEN', 403);
  }
  if (uid === memberId) {
    return jsonError('CANNOT_DELETE_SELF', 400);
  }

  try {
    await ensurePointTables(DB);

    const memberExists = await DB.prepare('SELECT id FROM users WHERE id=? LIMIT 1')
      .bind(memberId)
      .first<{ id: string }>();
    if (!memberExists) {
      return jsonError('NOT_FOUND', 404);
    }

    const linkRows = await DB.prepare('SELECT id FROM links WHERE owner_id=?').bind(memberId).all();
    const linkIds = ((linkRows.results as Array<{ id?: string }> | undefined) ?? [])
      .map((row) => (row.id ? String(row.id) : null))
      .filter((value): value is string => Boolean(value));

    const r2Keys: string[] = [];
    for (const linkId of linkIds) {
      const fileRows = await DB.prepare('SELECT r2_key FROM files WHERE link_id=?')
        .bind(linkId)
        .all();
      const keys = ((fileRows.results as Array<{ r2_key?: string | null }> | undefined) ?? [])
        .map((row) => (row.r2_key ? String(row.r2_key) : null))
        .filter((value): value is string => Boolean(value));
      r2Keys.push(...keys);
    }

    await DB.exec('BEGIN');
    try {
      for (const linkId of linkIds) {
        await DB.prepare('DELETE FROM files WHERE link_id=?').bind(linkId).run();
        await DB.prepare('DELETE FROM links WHERE id=?').bind(linkId).run();
      }
      await DB.prepare('DELETE FROM users WHERE id=?').bind(memberId).run();
      await DB.exec('COMMIT');
    } catch (error) {
      await DB.exec('ROLLBACK');
      throw error;
    }

    await Promise.all(
      linkIds.map(async (linkId) => {
        const tableName = getStatsTableName(linkId);
        await DB.exec(`DROP TABLE IF EXISTS "${tableName}"`).catch(() => undefined);
      })
    );

    await DB.prepare('DELETE FROM point_accounts WHERE id=?')
      .bind(memberId)
      .run()
      .catch(() => undefined);
    await DB.prepare('DELETE FROM point_ledger WHERE account_id=?')
      .bind(memberId)
      .run()
      .catch(() => undefined);

    if (r2Keys.length) {
      await Promise.all(
        r2Keys.map(async (key) => {
          try {
            await R2.delete(key);
          } catch {
            // ignore individual deletion errors
          }
        })
      );
    }

    return NextResponse.json({ ok: true, deleted: memberId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message || 'DELETE_FAILED', 500);
  }
}
