import { useEffect, useSyncExternalStore } from 'react';
import { languageStore, translate, translateMessage } from './i18n.ts';

export function useLanguage() {
  const language = useSyncExternalStore(languageStore.subscribe, languageStore.getSnapshot, languageStore.getSnapshot);
  return { language, setLanguage: languageStore.setLanguage,
    t: (key: string, values?: Record<string, string | number>) => translate(language, key, values),
    message: (text: string) => translateMessage(language, text) };
}
export function useDocumentLanguage() {
  const { language, t } = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, 'Microsoft 365 Tenant Security Dashboard');
  }, [language]);
  return { language, t };
}
