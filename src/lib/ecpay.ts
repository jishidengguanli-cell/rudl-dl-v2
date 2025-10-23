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

// Lightweight MD5 implementation adapted from the public domain reference (RFC 1321).
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const md5 = (input: string) => {
  const utf8 = textEncoder?.encode(input) ?? (() => {
    const result = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      result[i] = input.charCodeAt(i) & 0xff;
    }
    return result;
  })();
  const x: number[] = [];
  const length = utf8.length;

  for (let i = 0; i < length; i++) {
    x[i >> 2] = x[i >> 2] ?? 0;
    x[i >> 2] |= utf8[i] << ((i % 4) * 8);
  }

  const padIndex = length;
  x[padIndex >> 2] = x[padIndex >> 2] ?? 0;
  x[padIndex >> 2] |= 0x80 << ((padIndex % 4) * 8);
  x[(((length + 64) >>> 9) << 4) + 14] = length * 8;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const addUnsigned = (xValue: number, yValue: number) => {
    const x4 = xValue & 0x40000000;
    const y4 = yValue & 0x40000000;
    const x8 = xValue & 0x80000000;
    const y8 = yValue & 0x80000000;
    const result = (xValue & 0x3fffffff) + (yValue & 0x3fffffff);
    if (x4 & y4) {
      return result ^ 0x80000000 ^ x8 ^ y8;
    }
    if (x4 | y4) {
      if (result & 0x40000000) {
        return result ^ 0xc0000000 ^ x8 ^ y8;
      }
      return result ^ 0x40000000 ^ x8 ^ y8;
    }
    return result ^ x8 ^ y8;
  };

  const rotateLeft = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));

  const F = (xValue: number, yValue: number, zValue: number) => (xValue & yValue) | (~xValue & zValue);
  const G = (xValue: number, yValue: number, zValue: number) => (xValue & zValue) | (yValue & ~zValue);
  const H = (xValue: number, yValue: number, zValue: number) => xValue ^ yValue ^ zValue;
  const I = (xValue: number, yValue: number, zValue: number) => yValue ^ (xValue | ~zValue);

  const round = (func: (x: number, y: number, z: number) => number, aValue: number, bValue: number, cValue: number, dValue: number, xValue: number, s: number, ac: number) =>
    addUnsigned(rotateLeft(addUnsigned(addUnsigned(aValue, func(bValue, cValue, dValue)), addUnsigned(xValue, ac)), s), bValue);

  for (let i = 0; i < x.length; i += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;

    a = round(F, a, b, c, d, x[i + 0] ?? 0, 7, 0xd76aa478);
    d = round(F, d, a, b, c, x[i + 1] ?? 0, 12, 0xe8c7b756);
    c = round(F, c, d, a, b, x[i + 2] ?? 0, 17, 0x242070db);
    b = round(F, b, c, d, a, x[i + 3] ?? 0, 22, 0xc1bdceee);
    a = round(F, a, b, c, d, x[i + 4] ?? 0, 7, 0xf57c0faf);
    d = round(F, d, a, b, c, x[i + 5] ?? 0, 12, 0x4787c62a);
    c = round(F, c, d, a, b, x[i + 6] ?? 0, 17, 0xa8304613);
    b = round(F, b, c, d, a, x[i + 7] ?? 0, 22, 0xfd469501);
    a = round(F, a, b, c, d, x[i + 8] ?? 0, 7, 0x698098d8);
    d = round(F, d, a, b, c, x[i + 9] ?? 0, 12, 0x8b44f7af);
    c = round(F, c, d, a, b, x[i + 10] ?? 0, 17, 0xffff5bb1);
    b = round(F, b, c, d, a, x[i + 11] ?? 0, 22, 0x895cd7be);
    a = round(F, a, b, c, d, x[i + 12] ?? 0, 7, 0x6b901122);
    d = round(F, d, a, b, c, x[i + 13] ?? 0, 12, 0xfd987193);
    c = round(F, c, d, a, b, x[i + 14] ?? 0, 17, 0xa679438e);
    b = round(F, b, c, d, a, x[i + 15] ?? 0, 22, 0x49b40821);

    a = round(G, a, b, c, d, x[i + 1] ?? 0, 5, 0xf61e2562);
    d = round(G, d, a, b, c, x[i + 6] ?? 0, 9, 0xc040b340);
    c = round(G, c, d, a, b, x[i + 11] ?? 0, 14, 0x265e5a51);
    b = round(G, b, c, d, a, x[i + 0] ?? 0, 20, 0xe9b6c7aa);
    a = round(G, a, b, c, d, x[i + 5] ?? 0, 5, 0xd62f105d);
    d = round(G, d, a, b, c, x[i + 10] ?? 0, 9, 0x02441453);
    c = round(G, c, d, a, b, x[i + 15] ?? 0, 14, 0xd8a1e681);
    b = round(G, b, c, d, a, x[i + 4] ?? 0, 20, 0xe7d3fbc8);
    a = round(G, a, b, c, d, x[i + 9] ?? 0, 5, 0x21e1cde6);
    d = round(G, d, a, b, c, x[i + 14] ?? 0, 9, 0xc33707d6);
    c = round(G, c, d, a, b, x[i + 3] ?? 0, 14, 0xf4d50d87);
    b = round(G, b, c, d, a, x[i + 8] ?? 0, 20, 0x455a14ed);
    a = round(G, a, b, c, d, x[i + 13] ?? 0, 5, 0xa9e3e905);
    d = round(G, d, a, b, c, x[i + 2] ?? 0, 9, 0xfcefa3f8);
    c = round(G, c, d, a, b, x[i + 7] ?? 0, 14, 0x676f02d9);
    b = round(G, b, c, d, a, x[i + 12] ?? 0, 20, 0x8d2a4c8a);

    a = round(H, a, b, c, d, x[i + 5] ?? 0, 4, 0xfffa3942);
    d = round(H, d, a, b, c, x[i + 8] ?? 0, 11, 0x8771f681);
    c = round(H, c, d, a, b, x[i + 11] ?? 0, 16, 0x6d9d6122);
    b = round(H, b, c, d, a, x[i + 14] ?? 0, 23, 0xfde5380c);
    a = round(H, a, b, c, d, x[i + 1] ?? 0, 4, 0xa4beea44);
    d = round(H, d, a, b, c, x[i + 4] ?? 0, 11, 0x4bdecfa9);
    c = round(H, c, d, a, b, x[i + 7] ?? 0, 16, 0xf6bb4b60);
    b = round(H, b, c, d, a, x[i + 10] ?? 0, 23, 0xbebfbc70);
    a = round(H, a, b, c, d, x[i + 13] ?? 0, 4, 0x289b7ec6);
    d = round(H, d, a, b, c, x[i + 0] ?? 0, 11, 0xeaa127fa);
    c = round(H, c, d, a, b, x[i + 3] ?? 0, 16, 0xd4ef3085);
    b = round(H, b, c, d, a, x[i + 6] ?? 0, 23, 0x04881d05);
    a = round(H, a, b, c, d, x[i + 9] ?? 0, 4, 0xd9d4d039);
    d = round(H, d, a, b, c, x[i + 12] ?? 0, 11, 0xe6db99e5);
    c = round(H, c, d, a, b, x[i + 15] ?? 0, 16, 0x1fa27cf8);
    b = round(H, b, c, d, a, x[i + 2] ?? 0, 23, 0xc4ac5665);

    a = round(I, a, b, c, d, x[i + 0] ?? 0, 6, 0xf4292244);
    d = round(I, d, a, b, c, x[i + 7] ?? 0, 10, 0x432aff97);
    c = round(I, c, d, a, b, x[i + 14] ?? 0, 15, 0xab9423a7);
    b = round(I, b, c, d, a, x[i + 5] ?? 0, 21, 0xfc93a039);
    a = round(I, a, b, c, d, x[i + 12] ?? 0, 6, 0x655b59c3);
    d = round(I, d, a, b, c, x[i + 3] ?? 0, 10, 0x8f0ccc92);
    c = round(I, c, d, a, b, x[i + 10] ?? 0, 15, 0xffeff47d);
    b = round(I, b, c, d, a, x[i + 1] ?? 0, 21, 0x85845dd1);
    a = round(I, a, b, c, d, x[i + 8] ?? 0, 6, 0x6fa87e4f);
    d = round(I, d, a, b, c, x[i + 15] ?? 0, 10, 0xfe2ce6e0);
    c = round(I, c, d, a, b, x[i + 6] ?? 0, 15, 0xa3014314);
    b = round(I, b, c, d, a, x[i + 13] ?? 0, 21, 0x4e0811a1);
    a = round(I, a, b, c, d, x[i + 4] ?? 0, 6, 0xf7537e82);
    d = round(I, d, a, b, c, x[i + 11] ?? 0, 10, 0xbd3af235);
    c = round(I, c, d, a, b, x[i + 2] ?? 0, 15, 0x2ad7d2bb);
    b = round(I, b, c, d, a, x[i + 9] ?? 0, 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  const toHex = (value: number) => {
    let hex = '';
    for (let j = 0; j <= 3; j++) {
      const byte = (value >>> (j * 8)) & 255;
      const hexByte = (`0${byte.toString(16)}`).slice(-2);
      hex += hexByte;
    }
    return hex;
  };

  return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toUpperCase();
};

const computeCheckMacValue = (payload: Record<string, string | number>, hashKey: string, hashIv: string) => {
  const sorted = Object.keys(payload)
    .filter((key) => key !== 'CheckMacValue')
    .sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));

  const query = sorted.map((key) => `${key}=${payload[key]}`).join('&');
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIv}`;
  const encoded = encodeValue(raw);
  return md5(encoded);
};

export const getCashierUrl = () => (mode === 'production' ? PROD_CASHIER_URL : STAGE_CASHIER_URL);

export const verifyCheckMacValue = (payload: Record<string, string | number>) => {
  const { hashKey, hashIv } = getCredentials();
  const provided = String(payload.CheckMacValue ?? '');
  if (!provided) return false;
  const expected = computeCheckMacValue(payload, hashKey, hashIv);
  return provided.toUpperCase() === expected.toUpperCase();
};

const formatTradeDate = (date: Date) =>
  `${date.getFullYear()}/${`${date.getMonth() + 1}`.padStart(2, '0')}/${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`;

export function buildCheckoutForm(params: EcpayCheckoutParams) {
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
    ChoosePayment: params.paymentMethod ?? 'ALL',
    ClientBackURL: params.clientBackUrl ?? '',
    OrderResultURL: params.orderResultUrl ?? '',
    NeedExtraPaidInfo: 'Y',
    EncryptType: 1,
  };

  const CheckMacValue = computeCheckMacValue(payload, hashKey, hashIv);

  return {
    action: getCashierUrl(),
    form: {
      ...payload,
      TotalAmount: amount.toString(),
      CheckMacValue,
    },
  };
}
