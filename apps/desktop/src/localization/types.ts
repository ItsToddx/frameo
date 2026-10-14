export type Locale = 'en' | 'zh-CN';
export interface Message {
  en: string;
  zh: string;
  one?: string;
}
export type Catalog = Record<string, Message>;
export type Parameters = Record<string, string | number>;
export function normalizeLocale(value: unknown): Locale {
  return value === 'zh-CN' ? value : 'en';
}
