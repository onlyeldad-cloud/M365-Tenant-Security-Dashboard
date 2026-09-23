# Tenant-Sicherheitsdashboard: Frontend

React-/TypeScript-/Vite-Oberfl?che f?r die gesch?tzte Backend-API. Unterst?tzt **Deutsch / English**, standardm??ig Deutsch. **DE | EN** im Kopfbereich wechselt sofort; localStorage speichert nur `krn.dashboard.language`. Keine erneute Anmeldung, Autorisierung oder Bewertung beim Sprachwechsel.

Einrichtung, Architektur und Variablennamen: [Projekt-README](../README.md). Berechtigungen: [PERMISSION_MATRIX.md](../PERMISSION_MATRIX.md). Die SPA verwendet ausschlie?lich `Assessment.Read`; Graph-Zugriff erfolgt im Backend. Der [MSAL-v5-Redirect-Bridge-Aufruf](redirect.html) bleibt erhalten; lediglich sein sichtbarer Statustext wird lokalisiert.

```powershell
npm ci
npm run dev
```

Pr?fung: `npm test`, `npm run lint`, `npm run build`. Der Entwicklungsproxy verbindet `/api` mit dem Backend. `npm run preview` ist kein Ersatz f?r diese Weiterleitung.

?bersetzungen: `src/i18n/translations.ts`; Sprachspeicher und Formatierung: `src/i18n/i18n.ts`. Englische Anwendungstexte sind zentrale Schl?ssel. Bekannte Backend-Erkl?rungen werden nur bei der Darstellung ?bersetzt. Neue Texte ben?tigen ?bersetzungen und passende Tests. Regel-IDs, interne Statuswerte, Schweregrade, URLs, Zeitstempel und JSON-Nachweise bleiben unver?ndert. Keine Tenant-Daten durch die ?bersetzungsfunktionen leiten.

KRN-Marineblau/Gold bleibt erhalten. Optionales Original-Logo: `public/krn-logo.png`; ohne diese Datei erscheint die Textmarke.

**English note:** German is the default; DE/EN switching is local and persisted. Evidence and authentication remain unchanged. Follow the root README for installation and the existing npm commands above.
