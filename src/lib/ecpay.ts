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
};

const STAGE_CASHIER_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
const PROD_CASHIER_URL = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
const STAGE_QUERY_TRADE_INFO_URL = 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5';
const PROD_QUERY_TRADE_INFO_URL = 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5';

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

