import type { D1Database } from '@cloudflare/workers-types';

type Optional<T> = T | undefined | null;

export type EcpayCheckoutParams = {
  totalAmount: number;
  description: string;
  itemName: string;
  returnUrl: string;
  orderResultUrl: string;
  clientBackUrl?: string;
  paymentMethod?: 'ALL' | 'Credit' | 'ATM' | 'CVS' | 'BARCODE';
  paymentInfoUrl?: string;
  clientRedirectUrl?: string;
  needExtraPaidInfo?: 'Y' | 'N';
  customFields?: Partial<Record<'CustomField1' | 'CustomField2' | 'CustomField3' | 'CustomField4', string>>;
};

const STAGE_CASHIER_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
const PROD_CASHIER_URL = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
const STAGE_QUERY_TRADE_INFO_URL = 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5';
const PROD_QUERY_TRADE_INFO_URL = 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5';

const ORDERS_TABLE = 'ecpay_orders';

const normalizeEnv = (value: Optional<string>) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

const mode = normalizeEnv(process.env.ECPAY_MODE) ?? 'stage';

type Credentials = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
};

let ordersTableEnsured = false;
let ordersTableColumnsChecked = false;
let ordersTableHasLegacyTimestamps = false;

const detectOrdersTableColumns = async (DB: D1Database) => {
  if (ordersTableColumnsChecked) return;
  const result = await DB.prepare(`PRAGMA table_info(${ORDERS_TABLE})`)
    .all<{ name: string }>();
  const names = result.results?.map((row) => row.name) ?? [];
  ordersTableHasLegacyTimestamps = names.includes('created_at') && names.includes('updated_at') && names.includes('paid_at');
  ordersTableColumnsChecked = true;
};

const getCredentials = (overrides?: Partial<Credentials>): Credentials => {
  const merchantId = normalizeEnv(overrides?.merchantId ?? process.env.ECPAY_MERCHANT_ID);
  const hashKey = normalizeEnv(overrides?.hashKey ?? process.env.ECPAY_HASH_KEY);
  const hashIv = normalizeEnv(overrides?.hashIv ?? process.env.ECPAY_HASH_IV);

  if (!merchantId || !hashKey || !hashIv) {
    throw new Error('ECPAY credentials are not configured. Please set ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, and ECPAY_HASH_IV.');
  }

  return { merchantId, hashKey, hashIv };
};

const encodeValue = (input: string) =>
  encodeURIComponent(input)
    .toLowerCase()
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2a/g, '*')
    .replace(/%2d/g, '-')
    .replace(/%2e/g, '.')
    .replace(/%5f/g, '_');

const subtle = globalThis.crypto?.subtle;
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

const sha256Hex = async (value: string) => {
  if (!subtle || !textEncoder) {
    throw new Error('Web Crypto API is not available for SHA256 hashing.');
  }
  const data = textEncoder.encode(value);
  const digest = await subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
};

const toQueryString = (payload: Record<string, string | number>) =>
  Object.keys(payload)
    .filter((key) => key !== 'CheckMacValue')
    .sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }))
    .map((key) => `${key}=${payload[key]}`)
    .join('&');

const computeCheckMacValue = async (payload: Record<string, string | number>, hashKey: string, hashIv: string) => {
  const query = toQueryString(payload);
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIv}`;
  const encoded = encodeValue(raw);
  return sha256Hex(encoded);
};

export const getCashierUrl = () => (mode === 'production' ? PROD_CASHIER_URL : STAGE_CASHIER_URL);
export const getQueryTradeInfoUrl = () => (mode === 'production' ? PROD_QUERY_TRADE_INFO_URL : STAGE_QUERY_TRADE_INFO_URL);

export const verifyCheckMacValue = async (
  payload: Record<string, string | number>,
  credentialsOverride?: Partial<Credentials>
) => {
  const { hashKey, hashIv } = getCredentials(credentialsOverride);
  const provided = String(payload.CheckMacValue ?? '');
  if (!provided) {
    console.warn('[ecpay] missing CheckMacValue', payload);
    return false;
  }
  const expected = await computeCheckMacValue(payload, hashKey, hashIv);
  const providedUpper = provided.toUpperCase();
  const expectedUpper = expected.toUpperCase();
  if (providedUpper !== expectedUpper) {
    console.warn('[ecpay] CheckMacValue mismatch', {
      provided: providedUpper,
      expected: expectedUpper,
      payload,
    });
    return false;
  }
  return true;
};

const formatTradeDate = (date: Date) =>
  `${date.getFullYear()}/${`${date.getMonth() + 1}`.padStart(2, '0')}/${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`;

export async function buildCheckoutForm(params: EcpayCheckoutParams) {
  const { merchantId, hashKey, hashIv } = getCredentials();

  if (!Number.isFinite(params.totalAmount) || params.totalAmount <= 0) {
    throw new Error('ECPAY totalAmount must be a positive number.');
  }

  const amount = Math.round(Number(params.totalAmount));
  const tradeDate = formatTradeDate(new Date());
  const tradeNo = `RG${tradeDate.replace(/[^\d]/g, '')}${Math.floor(Math.random() * 10_000).toString().padStart(4, '0')}`;

  const payload = {
    MerchantID: merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType: 'aio',
    TotalAmount: amount,
    TradeDesc: params.description,
    ItemName: params.itemName,
    ReturnURL: params.returnUrl,
    OrderResultURL: params.orderResultUrl,
    ClientBackURL: params.clientBackUrl ?? '',
    PaymentInfoURL: params.paymentInfoUrl ?? '',
    ClientRedirectURL: params.clientRedirectUrl ?? '',
    ChoosePayment: params.paymentMethod ?? 'ALL',
    NeedExtraPaidInfo: params.needExtraPaidInfo ?? 'Y',
    EncryptType: 1,
    CustomField1: params.customFields?.CustomField1 ?? '',
    CustomField2: params.customFields?.CustomField2 ?? '',
    CustomField3: params.customFields?.CustomField3 ?? '',
    CustomField4: params.customFields?.CustomField4 ?? '',
  };

  const CheckMacValue = await computeCheckMacValue(payload, hashKey, hashIv);

  const form = Object.fromEntries(
    Object.entries({
      ...payload,
      TotalAmount: amount.toString(),
      CheckMacValue,
    }).map(([key, value]) => [key, typeof value === 'number' ? value.toString() : value])
  );

  return {
    action: getCashierUrl(),
    form,
  };
}

export type EcpayOrderStatus = 'PENDING' | 'PAID' | 'FAILED';

export type EcpayOrder = {
  merchantTradeNo: string;
  accountId: string;
  points: number;
  amount: number;
  currency: string;
  status: EcpayOrderStatus;
  description: string | null;
  itemName: string | null;
  customField1: string | null;
  customField2: string | null;
  customField3: string | null;
  rtnCode: string | null;
  rtnMsg: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  tradeNo: string | null;
  tradeAmt: number | null;
  paymentDate: string | null;
  ledgerId: string | null;
  balanceAfter: number | null;
  rawNotify: string | null;
  rawPaymentInfo: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  paidAt: number | null;
};

type OrderRow = Record<string, unknown> | null;

const toInteger = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toTimestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
};

const parseEcpayDate = (value: Optional<string>) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  const [year, month, day, hour, minute, second] = parts;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000+08:00`;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor(timestamp / 1000);
};

const parseRawPayload = (raw: Optional<unknown>): Record<string, string> | null => {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      result[key] = typeof value === 'string' ? value : String(value);
    });
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
};

type NormalizedEcpayPayload = {
  rtnCode: string | null;
  rtnMsg: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  tradeNo: string | null;
  tradeAmt: number | null;
  paymentDate: string | null;
  tradeDate: string | null;
  merchantTradeDate: string | null;
};

const mapOrder = (row: OrderRow): EcpayOrder | null => {
  if (!row) return null;
  const rawNotify = (row.raw_notify as string) ?? null;
  const rawPaymentInfo = (row.raw_payment_info as string) ?? null;
  const parsedNotify = parseRawPayload(rawNotify);
  const normalizedNotify = parsedNotify ? normalizeEcpayPayload(parsedNotify) : null;
  const resolvedPaymentMethod =
    (row.payment_method as string) ??
    normalizedNotify?.paymentMethod ??
    normalizedNotify?.paymentType ??
    null;
  const tradeAmtFromRow =
    row.trade_amt !== null && row.trade_amt !== undefined ? Number(row.trade_amt) : null;
  const tradeAmtFromNotify =
    normalizedNotify && normalizedNotify.tradeAmt !== null ? normalizedNotify.tradeAmt : null;
  const tradeAmt = tradeAmtFromRow ?? tradeAmtFromNotify;
  const paymentDateFromRow = (row.payment_date as string) ?? null;
  const paymentDate = paymentDateFromRow ?? normalizedNotify?.paymentDate ?? null;
  const createdAt =
    row && typeof row === 'object' && 'created_at' in row ? toTimestamp((row as Record<string, unknown>).created_at) : null;
  const updatedAt =
    row && typeof row === 'object' && 'updated_at' in row ? toTimestamp((row as Record<string, unknown>).updated_at) : null;
  const paidAt =
    row && typeof row === 'object' && 'paid_at' in row ? toTimestamp((row as Record<string, unknown>).paid_at) : null;
  return {
    merchantTradeNo: String(row.merchant_trade_no),
    accountId: String(row.account_id),
    points: Number(row.points ?? 0),
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? 'TWD'),
    status: (row.status as EcpayOrderStatus) ?? 'PENDING',
    description: (row.description as string) ?? null,
    itemName: (row.item_name as string) ?? null,
    customField1: (row.custom_field1 as string) ?? null,
    customField2: (row.custom_field2 as string) ?? null,
    customField3: (row.custom_field3 as string) ?? null,
    rtnCode: (row.rtn_code as string) ?? normalizedNotify?.rtnCode ?? null,
    rtnMsg: (row.rtn_msg as string) ?? normalizedNotify?.rtnMsg ?? null,
    paymentType: (row.payment_type as string) ?? normalizedNotify?.paymentType ?? null,
    paymentMethod: resolvedPaymentMethod,
    tradeNo: (row.trade_no as string) ?? normalizedNotify?.tradeNo ?? null,
    tradeAmt,
    paymentDate,
    ledgerId: (row.ledger_id as string) ?? null,
    balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
    rawNotify,
    rawPaymentInfo,
    createdAt,
    updatedAt,
    paidAt,
  };
};

const ensureOrdersTable = async (DB: D1Database) => {
  if (ordersTableEnsured) return;
  const tableExists = await DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`
  )
    .bind(ORDERS_TABLE)
    .first<{ name: string }>();

  if (!tableExists) {
    await DB.exec(
      `CREATE TABLE ${ORDERS_TABLE} (
        merchant_trade_no TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        points INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        description TEXT,
        item_name TEXT,
        custom_field1 TEXT,
        custom_field2 TEXT,
        custom_field3 TEXT,
        rtn_code TEXT,
        rtn_msg TEXT,
        payment_type TEXT,
        payment_method TEXT,
        trade_no TEXT,
        trade_amt INTEGER,
        payment_date TEXT,
        ledger_id TEXT,
        balance_after REAL,
        raw_notify TEXT,
        raw_payment_info TEXT
      );`
    );
  }

  await DB.exec(`CREATE INDEX IF NOT EXISTS idx_${ORDERS_TABLE}_account ON ${ORDERS_TABLE} (account_id);`);
  await detectOrdersTableColumns(DB);
  ordersTableEnsured = true;
};

type CreateOrderParams = {
  merchantTradeNo: string;
  accountId: string;
  points: number;
  amount: number;
  currency?: string;
  description: string;
  itemName: string;
  customField1?: string | null;
  customField2?: string | null;
  customField3?: string | null;
};

export async function createEcpayOrder(DB: D1Database, params: CreateOrderParams) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);

  const columns = [
    'merchant_trade_no',
    'account_id',
    'points',
    'amount',
    'currency',
    'status',
    'description',
    'item_name',
    'custom_field1',
    'custom_field2',
    'custom_field3',
  ];
  const values: Array<string | number | null> = [
    params.merchantTradeNo,
    params.accountId,
    Math.round(params.points),
    Math.round(params.amount),
    params.currency ?? 'TWD',
    'PENDING',
    params.description,
    params.itemName,
    params.customField1 ?? null,
    params.customField2 ?? null,
    params.customField3 ?? null,
  ];

  if (ordersTableHasLegacyTimestamps) {
    columns.push('created_at', 'updated_at');
    values.push(now, now);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${ORDERS_TABLE} (${columns.join(', ')}) VALUES (${placeholders})`;

  await DB.prepare(sql)
    .bind(...values)
    .run();
}

export async function getEcpayOrder(DB: D1Database, merchantTradeNo: string): Promise<EcpayOrder | null> {
  await ensureOrdersTable(DB);
  const row = await DB.prepare(`SELECT * FROM ${ORDERS_TABLE} WHERE merchant_trade_no=? LIMIT 1`)
    .bind(merchantTradeNo)
    .first<Record<string, unknown>>();
  return mapOrder(row ?? null);
}

export async function listEcpayOrdersForAccount(DB: D1Database, accountId: string): Promise<EcpayOrder[]> {
  await ensureOrdersTable(DB);
  const orderBy = ordersTableHasLegacyTimestamps ? 'created_at DESC' : 'rowid DESC';
  const result = await DB.prepare(`SELECT * FROM ${ORDERS_TABLE} WHERE account_id=? ORDER BY ${orderBy}`)
    .bind(accountId)
    .all<Record<string, unknown>>();
  const rows = (result.results as OrderRow[] | undefined) ?? [];
  return rows
    .map((row) => mapOrder(row))
    .filter((order): order is EcpayOrder => order !== null);
}

const getPayloadValue = (payload: Record<string, string>, key: string): string | null => {
  const candidates = [key, key.toLowerCase(), key.toUpperCase()];
  for (const candidate of candidates) {
    const value = payload[candidate];
    if (value !== undefined && value !== null && String(value).length > 0) {
      return String(value);
    }
  }
  return null;
};

const normalizeEcpayPayload = (payload: Record<string, string>): NormalizedEcpayPayload => {
  const rtnCode = getPayloadValue(payload, 'RtnCode');
  const paymentType = getPayloadValue(payload, 'PaymentType');
  const paymentMethod = getPayloadValue(payload, 'PaymentMethod') ?? getPayloadValue(payload, 'ChoosePayment');
  const tradeNo = getPayloadValue(payload, 'TradeNo');
  const tradeAmt = toInteger(getPayloadValue(payload, 'TradeAmt'));
  const paymentDate = getPayloadValue(payload, 'PaymentDate');
  const tradeDate = getPayloadValue(payload, 'TradeDate');
  const merchantTradeDate = getPayloadValue(payload, 'MerchantTradeDate');
  const rtnMsg = getPayloadValue(payload, 'RtnMsg');

  return {
    rtnCode,
    rtnMsg,
    paymentType,
    paymentMethod,
    tradeNo,
    tradeAmt,
    paymentDate: paymentDate ?? tradeDate ?? merchantTradeDate ?? null,
    tradeDate: tradeDate ?? merchantTradeDate ?? null,
    merchantTradeDate: merchantTradeDate ?? null,
  };
};

export async function markEcpayOrderPaymentInfo(
  DB: D1Database,
  merchantTradeNo: string,
  payload: Record<string, string>,
  source: 'notify' | 'orderResult' = 'notify'
) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeEcpayPayload(payload);
  const paymentMethod = normalized.paymentMethod ?? normalized.paymentType ?? null;
  const tradeDateTimestamp = parseEcpayDate(normalized.tradeDate ?? normalized.paymentDate);
  const allowFieldUpdates = source === 'orderResult';

  const assignments: string[] = [];
  const params: Array<string | number> = [];

  const setField = (column: string, value: string | number | null | undefined) => {
    if (!allowFieldUpdates) return;
    if (value === null || value === undefined) return;
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  setField('rtn_code', normalized.rtnCode);
  setField('rtn_msg', normalized.rtnMsg);
  setField('payment_type', normalized.paymentType);
  setField('payment_method', paymentMethod);
  setField('trade_no', normalized.tradeNo);
  setField('trade_amt', normalized.tradeAmt);
  setField('payment_date', normalized.paymentDate);

  if (source === 'notify') {
    if (ordersTableHasLegacyTimestamps && allowFieldUpdates && tradeDateTimestamp !== null) {
      assignments.push('created_at = ?');
      params.push(tradeDateTimestamp);
    }
    assignments.push('raw_notify = ?');
    params.push(JSON.stringify(payload));
  } else {
    if (ordersTableHasLegacyTimestamps && tradeDateTimestamp !== null) {
      assignments.push('created_at = ?');
      params.push(tradeDateTimestamp);
    }
    assignments.push('raw_payment_info = ?');
    params.push(JSON.stringify(payload));
  }

  if (ordersTableHasLegacyTimestamps) {
    assignments.push('updated_at = ?');
    params.push(now);
  }

  if (!assignments.length) return;

  const sql = `UPDATE ${ORDERS_TABLE} SET ${assignments.join(', ')} WHERE merchant_trade_no = ?`;
  params.push(merchantTradeNo);

  const result = await DB.prepare(sql)
    .bind(...params)
    .run();

  const changes = (result as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  console.info('[ecpay] mark paid result', {
    merchantTradeNo,
    changes,
    success: (result as { success?: boolean }).success,
    params,
    sql,
  });
  if (!changes) {
    console.warn('[ecpay] mark paid did not update any row', { merchantTradeNo, params, sql });
  }
}

type OrderNotifyPayload = {
  rtnCode: string;
  rtnMsg: string;
  paymentType?: string;
  paymentMethod?: string;
  tradeNo?: string;
  tradeAmt?: string | number;
  paymentDate?: string;
  raw: Record<string, string>;
  ledgerId?: string | null;
  balanceAfter?: number | null;
};

type OrderDataSource = 'notify' | 'orderResult';

export async function markEcpayOrderPaid(
  DB: D1Database,
  merchantTradeNo: string,
  payload: OrderNotifyPayload,
  source: OrderDataSource = 'notify'
) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeEcpayPayload(payload.raw);
  const rtnCode = normalized.rtnCode ?? payload.rtnCode;
  const rtnMsg = normalized.rtnMsg ?? payload.rtnMsg;
  const paymentType = normalized.paymentType ?? payload.paymentType ?? null;
  const paymentMethod = normalized.paymentMethod ?? normalized.paymentType ?? payload.paymentMethod ?? payload.paymentType ?? null;
  const tradeNo = normalized.tradeNo ?? payload.tradeNo ?? null;
  const tradeAmt = normalized.tradeAmt ?? toInteger(payload.tradeAmt);
  const paymentDate = normalized.paymentDate ?? payload.paymentDate ?? null;
  const paymentDateTimestamp = parseEcpayDate(paymentDate);
  const tradeDateTimestamp = parseEcpayDate(normalized.tradeDate ?? paymentDate);

  const assignments: string[] = ['status = ?'];
  const params: Array<string | number> = ['PAID'];

  const setField = (column: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return;
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  setField('rtn_code', rtnCode);
  setField('rtn_msg', rtnMsg);
  setField('payment_type', paymentType);
  setField('payment_method', paymentMethod);
  setField('trade_no', tradeNo);
  setField('trade_amt', tradeAmt);
  setField('payment_date', paymentDate);

  if (ordersTableHasLegacyTimestamps) {
    const paidAtTimestamp = paymentDateTimestamp ?? tradeDateTimestamp ?? now;
    assignments.push('paid_at = COALESCE(paid_at, ?)');
    params.push(paidAtTimestamp);
  }

  setField('ledger_id', payload.ledgerId ?? null);
  if (payload.balanceAfter !== null && payload.balanceAfter !== undefined) {
    setField('balance_after', payload.balanceAfter);
  }

  if (ordersTableHasLegacyTimestamps && tradeDateTimestamp !== null) {
    assignments.push('created_at = ?');
    params.push(tradeDateTimestamp);
  }

  const rawColumn = source === 'orderResult' ? 'raw_payment_info' : 'raw_notify';
  assignments.push(`${rawColumn} = ?`);
  params.push(JSON.stringify(payload.raw));

  if (ordersTableHasLegacyTimestamps) {
    assignments.push('updated_at = ?');
    params.push(now);
  }

  const sql = `UPDATE ${ORDERS_TABLE} SET ${assignments.join(', ')} WHERE merchant_trade_no = ?`;
  params.push(merchantTradeNo);

  await DB.prepare(sql)
    .bind(...params)
    .run();
}

export async function markEcpayOrderFailed(
  DB: D1Database,
  merchantTradeNo: string,
  payload: { rtnCode: string; rtnMsg: string; raw: Record<string, string> },
  source: OrderDataSource = 'notify'
) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeEcpayPayload(payload.raw);
  const paymentMethod = normalized.paymentMethod ?? normalized.paymentType ?? null;
  const tradeDateTimestamp = parseEcpayDate(normalized.tradeDate ?? normalized.paymentDate);

  const assignments: string[] = ['status = ?'];
  const params: Array<string | number> = ['FAILED'];

  const setField = (column: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return;
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  setField('rtn_code', normalized.rtnCode ?? payload.rtnCode);
  setField('rtn_msg', normalized.rtnMsg ?? payload.rtnMsg);
  setField('payment_type', normalized.paymentType);
  setField('payment_method', paymentMethod);
  setField('trade_no', normalized.tradeNo);
  setField('trade_amt', normalized.tradeAmt);
  setField('payment_date', normalized.paymentDate);

  if (ordersTableHasLegacyTimestamps && tradeDateTimestamp !== null) {
    assignments.push('created_at = ?');
    params.push(tradeDateTimestamp);
  }

  const rawColumn = source === 'orderResult' ? 'raw_payment_info' : 'raw_notify';
  assignments.push(`${rawColumn} = ?`);
  params.push(JSON.stringify(payload.raw));

  if (ordersTableHasLegacyTimestamps) {
    assignments.push('updated_at = ?');
    params.push(now);
  }

  const sql = `UPDATE ${ORDERS_TABLE} SET ${assignments.join(', ')} WHERE merchant_trade_no = ?`;
  params.push(merchantTradeNo);

  await DB.prepare(sql)
    .bind(...params)
    .run();
}

export async function recordEcpayRawNotify(DB: D1Database, merchantTradeNo: string, payload: Record<string, string>) {
  await ensureOrdersTable(DB);
  await DB.prepare(
    `UPDATE ${ORDERS_TABLE}
     SET raw_notify = ?
     WHERE merchant_trade_no = ?`
  )
    .bind(JSON.stringify(payload), merchantTradeNo)
    .run();
}
