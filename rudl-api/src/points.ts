// rudl-api/src/points.ts
// 統一使用 account_id / delta 的點數工具函式
// 與 D1 搭配：point_accounts(id, balance), point_ledger(id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)

export type LedgerRow = {
  id: string;
  account_id: string;
  delta: number;
  reason: string | null;
  link_id: string | null;
  download_id: string | null;
  bucket_minute: number | null;
  platform: string | null;
  created_at: number;
};

export type AdjustParams = {
  accountId: string;
  delta: number;               // 正數=加點，負數=扣點
  reason?: string;             // 例如 'manual', 'download', 'refund'
  linkId?: string | null;
  downloadId?: string | null;
  bucketMinute?: number | null;
  platform?: string | null;    // 'apk' | 'ipa' | ...
};

type DB = D1Database;

/** 產生 UUID（Workers 原生支援） */
function uuid() {
  return crypto.randomUUID();
}

/** 確保帳戶存在（沒有就以 0 新增） */
export async function ensureAccount(db: DB, accountId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO point_accounts (id, balance) VALUES (?, 0)')
    .bind(accountId)
    .run();
}

/** 取得目前餘額；找不到回傳 null */
export async function getBalance(db: DB, accountId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT balance FROM point_accounts WHERE id=?')
    .bind(accountId)
    .first<{ balance: number }>();
  return row?.balance ?? null;
}

/** 查詢異動明細（分頁） */
export async function getLedger(
  db: DB,
  accountId: string,
  limit = 20,
  offset = 0
): Promise<LedgerRow[]> {
  const res = await db
    .prepare(
      `SELECT id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at
       FROM point_ledger
       WHERE account_id=?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(accountId, limit, offset)
    .all<LedgerRow>();
  return (res?.results ?? []) as LedgerRow[];
}

/** 加/扣點：同時寫入 point_accounts 與 point_ledger；回傳最新餘額與 ledgerId */
export async function adjustPoints(
  db: DB,
  params: AdjustParams
): Promise<{ balance: number; ledgerId: string }> {
  const accountId = params.accountId;
  const delta = Math.trunc(Number(params.delta || 0));
  const reason = params.reason ?? null;
  const linkId = params.linkId ?? null;
  const downloadId = params.downloadId ?? null;
  const bucketMinute = params.bucketMinute ?? null;
  const platform = params.platform ?? null;

  if (!accountId) throw new Error('accountId is required');
  if (!Number.isFinite(delta) || delta === 0) throw new Error('delta must be a non-zero integer');

  const now = Date.now();
  const ledgerId = uuid();

  // 1) 確保有帳戶
  const s1 = db
    .prepare('INSERT OR IGNORE INTO point_accounts (id, balance) VALUES (?, 0)')
    .bind(accountId);

  // 2) 更新餘額
  const s2 = db
    .prepare('UPDATE point_accounts SET balance = balance + ? WHERE id=?')
    .bind(delta, accountId);

  // 3) 寫入異動明細
  const s3 = db
    .prepare(
      `INSERT INTO point_ledger
       (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(ledgerId, accountId, delta, reason, linkId, downloadId, bucketMinute, platform, now);

  await db.batch([s1, s2, s3]);

  // 4) 取回最新餘額
  const after = await getBalance(db, accountId);
  if (after === null) throw new Error('Account Not Found after adjust');

  return { balance: after, ledgerId };
}

/** 充值（語義糖） */
export async function topup(
  db: DB,
  accountId: string,
  points: number,
  reason = 'topup'
) {
  return adjustPoints(db, { accountId, delta: Math.abs(points), reason });
}

/** 扣點（語義糖），例如下載扣點 */
export async function charge(
  db: DB,
  accountId: string,
  points: number,
  opts: Omit<AdjustParams, 'accountId' | 'delta'> = {}
) {
  return adjustPoints(db, {
    accountId,
    delta: -Math.abs(points),
    reason: opts.reason ?? 'charge',
    linkId: opts.linkId ?? null,
    downloadId: opts.downloadId ?? null,
    bucketMinute: opts.bucketMinute ?? null,
    platform: opts.platform ?? null,
  });
}
