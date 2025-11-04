import { getRequestContext } from '@cloudflare/next-on-pages';
import RechargeClient from './RechargeClient';

export const runtime = 'edge';

export default function RechargePage() {
  let enableEcpay = true;
  try {
    const context = getRequestContext();
    const country = context?.cf?.country;
    enableEcpay = country ? country === 'TW' : true;
  } catch {
    enableEcpay = true;
  }

  return <RechargeClient enableEcpay={enableEcpay} />;
}
