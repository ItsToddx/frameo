import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  translate,
  formatDate,
  localizeHostText,
  normalizeLocale,
  type Locale,
  type MessageKey,
  type Parameters,
} from '../localization';
interface LanguageContext {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}
const Context = createContext<LanguageContext | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  const context = useContext(Context);
  if (!context) throw Error('I18nProvider is required');
  return {
    ...context,
    t: (key: MessageKey, params?: Parameters) => translate(context.locale, key, params),
    date: (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
      formatDate(context.locale, value, options),
    hostText: (value: string) => localizeHostText(value, context.locale),
  };
}
export { normalizeLocale };
export type { Locale };
