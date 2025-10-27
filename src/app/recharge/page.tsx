import { getRequestContext } from '@cloudflare/next-on-pages';
import RechargeClient from './RechargeClient';

export const runtime = 'edge';

export default function RechargePage() {
  const { cf } = getRequestContext();
  const country = cf?.country;
  const enableEcpay = country ? country === 'TW' : true;

  return <RechargeClient enableEcpay={enableEcpay} />;
}
