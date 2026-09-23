import { createElement } from 'react';
import { useLanguage } from './useLanguage.ts';
import type { Language } from './i18n.ts';

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  return createElement('div', { className: 'language-selector', role: 'group', 'aria-label': t('Language') },
    ...(['de', 'en'] as Language[]).map(code => createElement('button', {
      key: code, type: 'button', lang: code, 'aria-pressed': language === code,
      'aria-label': t(code === 'de' ? 'Switch to German' : 'Switch to English'),
      onClick: () => setLanguage(code),
    }, code.toUpperCase())));
}
