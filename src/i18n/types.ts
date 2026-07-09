import type { zhCN } from "./messages/zh-CN";

type WidenStrings<T> = T extends string
  ? string
  : T extends Record<string, unknown>
    ? {
        [K in keyof T]: WidenStrings<T[K]>;
      }
    : T;

export type MessageSchema = WidenStrings<typeof zhCN>;

export type Locale = "zh-CN" | "en-US";

type Join<K, P> = K extends string
  ? P extends string
    ? `${K}.${P}`
    : never
  : never;

type Leaves<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]>>;
    }[keyof T & string];

export type TranslationKey = Leaves<MessageSchema>;
