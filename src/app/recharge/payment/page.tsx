import { getRequestContext } from '@cloudflare/next-on-pages';
import PaymentClient from './PaymentClient';

export const runtime = 'edge';

export default function RechargePaymentPage() {
  let enableEcpay = true;
  try {
    const context = getRequestContext();
    const country = context?.cf?.country;
    enableEcpay = country ? country === 'TW' : true;
  } catch {
    enableEcpay = true;
  }

  return <PaymentClient enableEcpay={enableEcpay} />;
}
