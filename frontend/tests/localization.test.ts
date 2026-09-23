import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLanguageStore, languageStorageKey, languageStore, readLanguage, translate, translateMessage } from '../src/i18n/i18n.ts';
import { LanguageSelector } from '../src/i18n/LanguageSelector.ts';
import { german } from '../src/i18n/translations.ts';
import { statuses, severities, summarize, filterFindings } from '../src/dashboardModel.ts';
import type { Finding } from '../../backend/src/contracts.ts';
import ts from 'typescript';

function storage(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[languageStorageKey, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test('German is the default for missing, invalid and inaccessible language storage', () => {
  assert.equal(readLanguage(), 'de');
  for (const saved of [undefined, '', 'fr', 'DE', 'de']) assert.equal(createLanguageStore(storage(saved)).getSnapshot(), 'de');
  assert.equal(readLanguage({ getItem: () => { throw Error('blocked'); }, setItem: () => {} }), 'de');
});
test('DE -> EN -> DE changes labels immediately and notifies subscribers once per change', () => {
  const store = createLanguageStore(storage()); const seen: string[] = [];
  const unsubscribe = store.subscribe(() => { seen.push(translate(store.getSnapshot(), 'Run assessment')); });
  assert.equal(translate(store.getSnapshot(), 'Run assessment'), 'Bewertung starten');
  store.setLanguage('en'); store.setLanguage('en'); store.setLanguage('de');
  assert.deepEqual(seen, ['Run assessment', 'Bewertung starten']); unsubscribe();
});
test('language selection survives a recreated store and writes only the preference key', () => {
  const saved = storage(); const store = createLanguageStore(saved);
  store.setLanguage('en'); assert.equal(saved.getItem(languageStorageKey), 'en');
  assert.equal(createLanguageStore(saved).getSnapshot(), 'en');
  store.setLanguage('de'); assert.equal(createLanguageStore(saved).getSnapshot(), 'de');
});
test('blocked persistence still permits in-memory switching', () => {
  const store = createLanguageStore({ getItem: () => null, setItem: () => { throw Error('blocked'); } });
  store.setLanguage('en'); assert.equal(store.getSnapshot(), 'en');
});
test('selector has native keyboard buttons, localized labels and active aria-pressed state', () => {
  languageStore.setLanguage('de');
  const de = renderToStaticMarkup(createElement(LanguageSelector));
  assert.match(de, /role="group" aria-label="Sprache"/);
  assert.match(de, /type="button" lang="de" aria-pressed="true" aria-label="Zu Deutsch wechseln"/);
  languageStore.setLanguage('en');
  const en = renderToStaticMarkup(createElement(LanguageSelector));
  assert.match(en, /aria-label="Language"/);
  assert.match(en, /lang="en" aria-pressed="true" aria-label="Switch to English"/);
  languageStore.setLanguage('de');
});
test('internal statuses, severities, rule IDs, counts and authentic evidence remain unchanged', () => {
  const findings: Finding[] = statuses.map((status, index) => Object.freeze({ ruleId: `CA-00${index + 1}`, title: 'Guest accounts', status,
    severity: severities[index], why: 'Graph returned no incidents. This does not establish licensing, visibility, or the absence of threats.',
    evidence: Object.freeze({ displayName: 'Guest accounts', userPrincipalName: 'fixture@example.invalid', id: 'fixture', currentScore: 0 }),
    source: 'https://graph.microsoft.com/v1.0/users', checkedAt: '2026-01-01T00:00:00Z', recommendation: 'Review guest sponsors, business need, and access periodically.' }));
  const before = JSON.stringify(findings);
  for (const language of ['de', 'en', 'de'] as const) {
    for (const f of findings) { translateMessage(language, f.title); translateMessage(language, f.why); translateMessage(language, f.recommendation); }
    assert.equal(JSON.stringify(findings), before);
    assert.equal(summarize(findings).total, 4);
    assert.equal(filterFindings(findings, 'FAIL', 'Medium')[0].ruleId, 'CA-003');
  }
  assert.deepEqual(statuses, ['PASS', 'WARN', 'FAIL', 'N/A']);
  assert.deepEqual(statuses.map(s => translate('de', s)), ['BESTANDEN', 'WARNUNG', 'FEHLGESCHLAGEN', 'NICHT PRÜFBAR']);
});
test('all twelve rule titles and known explanations have German presentation', () => {
  const files = ['assessment', 'conditionalAccess', 'securityChecks', 'graph'];
  // Evidence JSON is intentionally not localized. These strings occur only inside evidence.
  const evidenceOnly = new Set(['Missing required fields or records', 'Invalid or duplicate snapshot control', 'Full score in current snapshot', 'Not Checkable with the current scanner scope']);
  const missing: string[] = [];
  for (const name of files) {
    const path = new URL(`../../backend/src/${name}.ts`, import.meta.url);
    const source = ts.createSourceFile(name + '.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node) && /[a-zA-Z] [a-zA-Z]/.test(node.text) && !evidenceOnly.has(node.text) && !node.text.includes('${')) {
        if (!german[node.text] && !['Not Checkable: '].includes(node.text)) missing.push(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(missing, []);
});
test('dynamic messages preserve counts, scopes and timestamps and do not diagnose a 403 cause', () => {
  const denied = 'Not Checkable: Access denied: check SecurityIncident.Read.All admin consent, your role, and tenant licensing.';
  const translated = translateMessage('de', denied);
  assert.match(translated, /^Nicht prüfbar: Zugriff verweigert/);
  assert.match(translated, /SecurityIncident.Read.All/);
  assert.match(translated, /genaue Ursache ist nicht festgestellt/);
  assert.equal(translateMessage('en', denied), denied);
  assert.match(translateMessage('de', 'Microsoft Secure Score: 0 / 100, snapshot 2026-01-01T00:00:00Z. PASS indicates data availability only, not a passing security score.'), /0 \/ 100, Momentaufnahme 2026-01-01T00:00:00Z/);
  assert.match(translateMessage('de', 'Not Checkable: Graph returned no Secure Score snapshots; no score can be inferred.'), /^Nicht prüfbar:/);
});
test('language module has no authentication, fetch, assessment or reload dependency', () => {
  for (const name of ['i18n.ts', 'useLanguage.ts', 'LanguageSelector.ts']) {
    const text = readFileSync(new URL(`../src/i18n/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /@azure|requestAssessment|acquireToken|loginPopup|logoutPopup|fetch\(|location\.|\.reload\(/);
  }
  const dashboard = readFileSync(new URL('../src/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /onClick=\{run\}/);
  assert.doesNotMatch(dashboard, /useEffect\([\s\S]*?\brun\(\)[\s\S]*?\[language\]/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<Dashboard key=\{accounts\[0\]\?\.homeAccountId\} \/>/);
  assert.doesNotMatch(app, /key=\{language\}/);
});
test('React static UI prose and accessibility labels cannot bypass the catalogue', () => {
  const exemptions = new Set(['Microsoft Secure Score', 'MICROSOFT 365', 'KR', 'N']);
  for (const name of ['App', 'Dashboard']) {
    const source = ts.createSourceFile(name + '.tsx', readFileSync(new URL(`../src/${name}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text)) assert.ok(exemptions.has(node.text.trim()), node.text);
      if (ts.isJsxAttribute(node) && ['aria-label', 'title'].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) assert.fail(node.getText(source));
      if (ts.isCallExpression(node) && ['t', 'setMessage', 'setError', 'setAuthError'].includes(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text) assert.ok(german[node.arguments[0].text], node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
