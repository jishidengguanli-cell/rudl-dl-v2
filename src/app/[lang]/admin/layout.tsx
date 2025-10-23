import type { ReactNode } from 'react';

export const runtime = 'edge';

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
