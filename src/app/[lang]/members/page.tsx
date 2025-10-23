import { redirect } from 'next/navigation';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

type Params = { lang: string };

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

export default async function LegacyMembersRedirect({ params }: { params: Promise<Params> }) {
  const { lang } = await params;
  const targetLocale = isLocale(lang) ? lang : DEFAULT_LOCALE;
  redirect(`/${targetLocale}/admin/members`);
}
