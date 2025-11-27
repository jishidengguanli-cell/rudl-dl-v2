export type RechargePackage = {
  points: number;
  priceUsd: number;
  priceTwd: number;
};

const USD_TO_TWD = 32;

const BASE_PACKAGES: Array<Omit<RechargePackage, 'priceTwd'>> = [
  { points: 200, priceUsd: 1 },
  { points: 1000, priceUsd: 5 },
  { points: 5000, priceUsd: 15 },
  { points: 15000, priceUsd: 35 },
  { points: 50000, priceUsd: 100 },
  { points: 100000, priceUsd: 200 },
];

export const PACKAGES: RechargePackage[] = BASE_PACKAGES.map((item) => ({
  ...item,
  priceTwd: Math.round(item.priceUsd * USD_TO_TWD),
}));
