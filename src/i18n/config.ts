import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";
import type { Locale, MessageSchema } from "./types";

export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "littletool-locale";

export const locales: Locale[] = ["zh-CN", "en-US"];

export const messages: Record<Locale, MessageSchema> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};
