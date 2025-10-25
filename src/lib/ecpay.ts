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

const getCredentials = (): Credentials => {
  const merchantId = normalizeEnv(process.env.ECPAY_MERCHANT_ID);
  const hashKey = normalizeEnv(process.env.ECPAY_HASH_KEY);
  const hashIv = normalizeEnv(process.env.ECPAY_HASH_IV);

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

export const verifyCheckMacValue = async (payload: Record<string, string | number>) => {
  const { hashKey, hashIv } = getCredentials();
  const provided = String(payload.CheckMacValue ?? '');
  if (!provided) return false;
  const expected = await computeCheckMacValue(payload, hashKey, hashIv);
  return provided.toUpperCase() === expected.toUpperCase();
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
  paidAt: number | null;
  ledgerId: string | null;
  balanceAfter: number | null;
  rawNotify: string | null;
  rawPaymentInfo: string | null;
  createdAt: number;
  updatedAt: number;
};

type OrderRow = Record<string, unknown> | null;

let ordersTableEnsured = false;

const toInteger = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const mapOrder = (row: OrderRow): EcpayOrder | null => {
  if (!row) return null;
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
    rtnCode: (row.rtn_code as string) ?? null,
    rtnMsg: (row.rtn_msg as string) ?? null,
    paymentType: (row.payment_type as string) ?? null,
    paymentMethod: (row.payment_method as string) ?? null,
    tradeNo: (row.trade_no as string) ?? null,
    tradeAmt: row.trade_amt !== null && row.trade_amt !== undefined ? Number(row.trade_amt) : null,
    paymentDate: (row.payment_date as string) ?? null,
    paidAt: row.paid_at !== null && row.paid_at !== undefined ? Number(row.paid_at) : null,
    ledgerId: (row.ledger_id as string) ?? null,
    balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
    rawNotify: (row.raw_notify as string) ?? null,
    rawPaymentInfo: (row.raw_payment_info as string) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
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
        paid_at INTEGER,
        ledger_id TEXT,
        balance_after REAL,
        raw_notify TEXT,
        raw_payment_info TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`
    );
  }

  await DB.exec(`CREATE INDEX IF NOT EXISTS idx_${ORDERS_TABLE}_account ON ${ORDERS_TABLE} (account_id);`);
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

  await DB.prepare(
    `INSERT INTO ${ORDERS_TABLE} (
      merchant_trade_no,
      account_id,
      points,
      amount,
      currency,
      status,
      description,
      item_name,
      custom_field1,
      custom_field2,
      custom_field3,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
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
      now,
      now
    )
    .run();
}

export async function getEcpayOrder(DB: D1Database, merchantTradeNo: string): Promise<EcpayOrder | null> {
  await ensureOrdersTable(DB);
  const row = await DB.prepare(`SELECT * FROM ${ORDERS_TABLE} WHERE merchant_trade_no=? LIMIT 1`)
    .bind(merchantTradeNo)
    .first<Record<string, unknown>>();
  return mapOrder(row ?? null);
}

export async function markEcpayOrderPaymentInfo(DB: D1Database, merchantTradeNo: string, payload: Record<string, string>) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);
  const paymentType = payload.PaymentType ?? null;
  const tradeAmt = toInteger(payload.TradeAmt);

  await DB.prepare(
    `UPDATE ${ORDERS_TABLE}
     SET payment_type = COALESCE(?, payment_type),
         payment_method = COALESCE(?, payment_method),
         trade_amt = COALESCE(?, trade_amt),
         raw_payment_info = ?,
         updated_at = ?
     WHERE merchant_trade_no = ?`
  )
    .bind(
      paymentType,
      payload.ChoosePayment ?? null,
      tradeAmt,
      JSON.stringify(payload),
      now,
      merchantTradeNo
    )
    .run();
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

export async function markEcpayOrderPaid(DB: D1Database, merchantTradeNo: string, payload: OrderNotifyPayload) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);
  const tradeAmt = toInteger(payload.tradeAmt);

  await DB.prepare(
    `UPDATE ${ORDERS_TABLE}
     SET status = 'PAID',
         rtn_code = ?,
         rtn_msg = ?,
         payment_type = COALESCE(?, payment_type),
         payment_method = COALESCE(?, payment_method),
         trade_no = ?,
         trade_amt = COALESCE(?, trade_amt),
         payment_date = COALESCE(?, payment_date),
         paid_at = COALESCE(paid_at, ?),
         ledger_id = COALESCE(?, ledger_id),
         balance_after = COALESCE(?, balance_after),
         raw_notify = ?,
         updated_at = ?
     WHERE merchant_trade_no = ?`
  )
    .bind(
      payload.rtnCode,
      payload.rtnMsg,
      payload.paymentType ?? null,
      payload.paymentMethod ?? null,
      payload.tradeNo ?? null,
      tradeAmt,
      payload.paymentDate ?? null,
      now,
      payload.ledgerId ?? null,
      payload.balanceAfter ?? null,
      JSON.stringify(payload.raw),
      now,
      merchantTradeNo
    )
    .run();
}

export async function markEcpayOrderFailed(DB: D1Database, merchantTradeNo: string, payload: { rtnCode: string; rtnMsg: string; raw: Record<string, string> }) {
  await ensureOrdersTable(DB);
  const now = Math.floor(Date.now() / 1000);
  await DB.prepare(
    `UPDATE ${ORDERS_TABLE}
     SET status = 'FAILED',
         rtn_code = ?,
         rtn_msg = ?,
         raw_notify = ?,
         updated_at = ?
     WHERE merchant_trade_no = ?`
  )
    .bind(payload.rtnCode, payload.rtnMsg, JSON.stringify(payload.raw), now, merchantTradeNo)
    .run();
}
