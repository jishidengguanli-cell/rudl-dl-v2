import type { Locale } from "./locales";
import zhTW from "./messages/zh-TW.json";
import en from "./messages/en.json";

export type Messages = Record<string, string>;

// 靜態映射，避免 Edge 環境的動態 import JSON 問題
const TABLE: Record<Locale, Messages> = {
  "zh-TW": zhTW as Messages,
  en: en as Messages,
};

export async function getMessages(locale: Locale): Promise<Messages> {
  return TABLE[locale] ?? TABLE["zh-TW"];
}
