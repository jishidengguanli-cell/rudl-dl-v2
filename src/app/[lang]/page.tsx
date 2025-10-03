import type { Locale } from "@/i18n/locales";
import { getMessages } from "@/i18n/get-messages";
import { t } from "@/i18n/t";

export const runtime = "edge";

export default async function Page({ params }: { params: { lang: Locale } }) {
  const msgs = await getMessages(params.lang);
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-medium">{t(msgs, "home.heading")}</h2>
      <p className="text-sm text-gray-600">{t(msgs, "home.desc", { lang: params.lang })}</p>
    </div>
  );
}
