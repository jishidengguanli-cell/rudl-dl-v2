import type { Locale } from "@/i18n/locales";
import { getMessages } from "@/i18n/get-messages";
import { t } from "@/i18n/t";

export const runtime = "edge";

type PageParams = { lang: Locale };

export default async function Page({ params }: { params: Promise<PageParams> }) {
  const { lang } = await params;
  const msgs = await getMessages(lang);
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-medium">{t(msgs, "home.heading")}</h2>
      <p className="text-sm text-gray-600">{t(msgs, "home.desc", { lang })}</p>
    </div>
  );
}