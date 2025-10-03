import type { Messages } from "./get-messages";

export function t(messages: Messages, key: string, vars?: Record<string, string | number>) {
  let s = messages[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
