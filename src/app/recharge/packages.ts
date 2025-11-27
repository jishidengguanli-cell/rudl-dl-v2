export type RechargePackage = {
  points: number;
  priceUsd: number;
  priceTwd: number;
  nowPaymentsUrl?: string;
};

const USD_TO_TWD = 32;

const BASE_PACKAGES: Array<Omit<RechargePackage, 'priceTwd'>> = [
  { points: 200, priceUsd: 1 },
  { points: 1000, priceUsd: 5 },
  { points: 5000, priceUsd: 15 },
  { points: 15000, priceUsd: 35, nowPaymentsUrl: 'https://nowpayments.io/payment/?iid=5485024027&source=button' },
  { points: 50000, priceUsd: 100, nowPaymentsUrl: 'https://nowpayments.io/payment/?iid=6249178675&source=button' },
  { points: 100000, priceUsd: 200, nowPaymentsUrl: 'https://nowpayments.io/payment/?iid=4315338693&source=button' },
];

export const PACKAGES: RechargePackage[] = BASE_PACKAGES.map((item) => ({
  ...item,
  priceTwd: Math.round(item.priceUsd * USD_TO_TWD),
}));
