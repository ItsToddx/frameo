import { common } from './common';
import { workbench } from './workbench';
import { panels } from './panels';
import { studio } from './studio';
import type { Locale, Parameters } from './types';
export { normalizeLocale } from './types';
export type { Locale, Catalog, Parameters } from './types';
export { localizeHostText } from './host-text';
export const messages = { ...common, ...workbench, ...panels, ...studio };
export type MessageKey = keyof typeof messages;
export function translate(locale: Locale, key: MessageKey, parameters: Parameters = {}): string {
  const message = messages[key];
  let value: string = locale === 'zh-CN' ? message.zh : message.en;
  if (locale === 'en' && parameters.count === 1 && 'one' in message) value = String(message.one);
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(parameters[name] ?? `{${name}}`));
}
export function formatDate(
  locale: Locale,
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? String(date)
    : new Intl.DateTimeFormat(locale, options).format(value);
}
