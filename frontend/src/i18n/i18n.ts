import { dynamicGerman, german } from './translations.ts';

export type Language = 'de' | 'en';
export const languageStorageKey = 'krn.dashboard.language';
export type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function browserStorage(): LanguageStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
export function readLanguage(storage?: LanguageStorage): Language {
  try { return storage?.getItem(languageStorageKey) === 'en' ? 'en' : 'de'; } catch { return 'de'; }
}
export function translate(language: Language, key: string, values: Record<string, string | number> = {}): string {
  const template = language === 'de' ? german[key] ?? key : key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
/** Presentation only. Call on known application prose, never evidence or tenant fields. */
export function translateMessage(language: Language, message: string): string {
  if (!message || language === 'en') return message;
  if (german[message]) return german[message];
  if (message.startsWith('Not Checkable: ')) return german['Not Checkable: '] + translateMessage(language, message.slice(15));
  for (const [pattern, replacement] of dynamicGerman) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  // Preserve unexpected future prose rather than inventing a translated verdict.
  return message;
}
export function createLanguageStore(storage?: LanguageStorage) {
  let language = readLanguage(storage);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => language,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setLanguage: (next: Language) => {
      if (next !== 'de' && next !== 'en') return;
      try { storage?.setItem(languageStorageKey, next); } catch { /* Private browsing/storage policies must not break the UI. */ }
      if (next === language) return;
      language = next;
      listeners.forEach(listener => listener());
    },
  };
}
export const languageStore = createLanguageStore(browserStorage());
