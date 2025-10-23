import { createHash } from 'node:crypto';

type Optional<T> = T | undefined | null;

export type EcpayCheckoutParams = {
  totalAmount: number;
  description: string;
  itemName: string;
  returnUrl: string;
  clientBackUrl?: string;
  orderResultUrl?: string;
  paymentMethod?: 'ALL' | 'Credit' | 'ATM' | 'CVS' | 'BARCODE';
};

const STAGE_CASHIER_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
const PROD_CASHIER_URL = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

const normalizeEnv = (value: Optional<string>) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

const merchantId = normalizeEnv(process.env.ECPAY_MERCHANT_ID);
const hashKey = normalizeEnv(process.env.ECPAY_HASH_KEY);
const hashIv = normalizeEnv(process.env.ECPAY_HASH_IV);

const mode = normalizeEnv(process.env.ECPAY_MODE) ?? 'stage';

function ensureCredentials() {
  if (!merchantId || !hashKey || !hashIv) {
    throw new Error('ECPAY credentials are not configured. Please set ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, and ECPAY_HASH_IV.');
  }
}

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

const toCheckMacValue = (payload: Record<string, string | number>) => {
  ensureCredentials();
  const sorted = Object.keys(payload)
    .filter((key) => key !== 'CheckMacValue')
    .sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));

  const query = sorted.map((key) => `${key}=${payload[key]}`).join('&');
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIv}`;
  const encoded = encodeValue(raw);
  return createHash('md5').update(encoded).digest('hex').toUpperCase();
};

export const getCashierUrl = () => (mode === 'production' ? PROD_CASHIER_URL : STAGE_CASHIER_URL);

export const verifyCheckMacValue = (payload: Record<string, string | number>) => {
  const provided = String(payload.CheckMacValue ?? '');
  if (!provided) return false;
  const expected = toCheckMacValue(payload);
  return provided.toUpperCase() === expected.toUpperCase();
};

const formatTradeDate = (date: Date) =>
  `${date.getFullYear()}/${`${date.getMonth() + 1}`.padStart(2, '0')}/${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`;

export function buildCheckoutForm(params: EcpayCheckoutParams) {
  ensureCredentials();

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
    ChoosePayment: params.paymentMethod ?? 'ALL',
    ClientBackURL: params.clientBackUrl ?? '',
    OrderResultURL: params.orderResultUrl ?? '',
    NeedExtraPaidInfo: 'Y',
    EncryptType: 1,
  };

  const CheckMacValue = toCheckMacValue(payload);

  return {
    action: getCashierUrl(),
    form: {
      ...payload,
      TotalAmount: amount.toString(),
      CheckMacValue,
    },
  };
}
