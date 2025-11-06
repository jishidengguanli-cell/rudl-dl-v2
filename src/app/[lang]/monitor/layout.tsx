import type { ReactNode } from 'react';
import MonitorLayout from '@/app/monitor/layout';

export const runtime = 'edge';

export default function LangMonitorLayout({ children }: { children: ReactNode }) {
  return <MonitorLayout>{children}</MonitorLayout>;
}

