# Acceptance criteria and implementation evidence

## Scope and evidence types

This matrix maps the assignment requirements supplied in this conversation to delivered files and tests. A separate external rubric was not provided. **Automated** evidence uses synthetic keys and mocked OBO/Graph; **review** evidence identifies source behavior; **live** evidence below is the project owner's reported tenant test. Automated tests do not establish live license availability or actual registration grants.

## Requirement mapping

| Acceptance criterion | Implementation evidence | Verification evidence |
| --- | --- | --- |
| React/TypeScript/Vite frontend and meaningful Node/Express API | [frontend/src/App.tsx](frontend/src/App.tsx), [backend/src/app.ts](backend/src/app.ts), [backend/src/server.ts](backend/src/server.ts) | Both builds; authenticated assessment API tests |
| Preserve MSAL v5 SPA login/redirect bridge | [frontend/src/authConfig.ts](frontend/src/authConfig.ts), [frontend/src/main.tsx](frontend/src/main.tsx), [frontend/redirect.html](frontend/redirect.html), [frontend/vite.config.ts](frontend/vite.config.ts) | Source review; redirect build artifact; owner-reported clean sign-out/sign-in |
| SPA has only delegated backend Assessment.Read | [frontend/src/Dashboard.tsx](frontend/src/Dashboard.tsx), [frontend/src/api.ts](frontend/src/api.ts), [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) | Frontend test: `frontend sends only an API bearer token to the local assessment endpoint`; owner-reported permission and enterprise-consent cleanup |
| Backend accepts its own API-audience token, never Graph tokens as API authentication | [backend/src/auth.ts](backend/src/auth.ts) | API tests reject both Graph audience forms and wrong issuer/tenant/caller |
| Validate signature, issuer, audience and expiry | [backend/src/auth.ts](backend/src/auth.ts) uses JOSE with tenant-specific JWKS and RS256 | API tests reject invalid signatures, wrong audience/issuer, expired/not-yet-valid and missing-expiration tokens |
| Require user-delegated scope and approved SPA | Required scp and azp validation in [auth.ts](backend/src/auth.ts) | `app-only, ID-like and missing-scope tokens cannot authorize assessments`; wrong-caller test |
| Certificate-based OAuth OBO on behalf of the authenticated user | [backend/src/obo.ts](backend/src/obo.ts) | Valid API/OBO mock test; request/provider isolation and forced-refresh test; owner-reported live success |
| No Graph writes, application Graph permissions, or client secrets | GET-only [graph.ts](backend/src/graph.ts), scope allowlist and acquireTokenOnBehalfOf in [obo.ts](backend/src/obo.ts) | Original GET enforcement regression; API mock validates GET; APP-001 exact delegated allowlist test; source review |
| Protected assessment and minimal health endpoint | GET `/api/assessment` and GET `/api/health` in [app.ts](backend/src/app.ts) | `health is public and minimal; assessment without authentication is 401`; valid authenticated assessment returns 12 findings/readouts |
| CORS only allows local frontend origin | [backend/src/app.ts](backend/src/app.ts) | `CORS rejects other origins and permits only GET preflight from the local frontend` |
| No tokens returned; errors sanitized | [app.ts](backend/src/app.ts), [obo.ts](backend/src/obo.ts), [frontend/src/api.ts](frontend/src/api.ts) | Token-echo/credential-field stripping test; OBO/provider/assessment/frontend error tests; no raw credential logging in reviewed code |
| Graph 401, 403, 429 and unavailable data handled | [backend/src/graph.ts](backend/src/graph.ts) | One-time renewal, persistent rejection, denied/empty/malformed/network failure tests; 403 produces dependent N/A |
| Honor Retry-After without infinite retries | Per-page maximum two retries; seconds/date parsing; long delays returned for manual retry | Original 429 test plus `API keeps bounded Retry-After behavior for Graph 429` |
| Page Graph collections safely | Validated origin/path/nextLink; redirects rejected; cycles and page limit; partial inventory discarded | User, incident, policy and profile paging tests; unsafe URL/cycle/malformed-nextLink/partial-provider tests |
| ORG-001 tenant metadata; USR-001 disabled users; USR-002 guests | [backend/src/assessment.ts](backend/src/assessment.ts) | Original complete/empty/limited-field rule regression cases |
| ROL-001 activated role inventory; ROL-002 direct Global Administrators | [backend/src/assessment.ts](backend/src/assessment.ts) | Original role status/group/limited-member tests; membership endpoint orchestration test |
| CA-001 administrator MFA; CA-002 legacy blocking; CA-003 exclusions | [backend/src/conditionalAccess.ts](backend/src/conditionalAccess.ts) | [nextChecks.test.ts](backend/tests/nextChecks.test.ts): enabled/report-only/disabled, OR/AND, authentication strengths, scoped coverage, exclusions, malformed data and combined blocking tests |
| SEC-001 current Secure Score; empty is N/A, never synthesized zero | [backend/src/securityChecks.ts](backend/src/securityChecks.ts) | Current/real-zero snapshot test; empty/stale/future/ambiguous/invalid snapshot tests; authenticated empty-score API test |
| SEC-002 supported improvement-action evidence | [backend/src/securityChecks.ts](backend/src/securityChecks.ts) | Profile/score matching, latest state, gap, ignored/reviewed/deprecated and missing-data tests. Derived candidates, not authoritative portal workflow. |
| DEF-001 open high-severity incidents | [backend/src/securityChecks.ts](backend/src/securityChecks.ts) | Active/inProgress high vs other/closed/unknown/empty incident tests; later-page incident test; owner reports live 403 correctly N/A |
| APP-001 permission requirements documented and checked | Local configuration check in [securityChecks.ts](backend/src/securityChecks.ts); [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) | Exact delegated scope list, missing/extra scope and application-type rejection tests; no claim of live registration-grant audit |
| PASS/WARN/FAIL/N/A and full finding fields | [backend/src/contracts.ts](backend/src/contracts.ts), rule evaluators | Rule status regressions; source review for title/severity/why/evidence/recommendation/source/checkedAt |
| Secure Score separate from own scanner totals | Microsoft category and [frontend/src/dashboardModel.ts](frontend/src/dashboardModel.ts) | Backend and frontend summary/filter tests; owner-reported separate live display |
| Dashboard cards, filters, detail view and loading/errors | [frontend/src/Dashboard.tsx](frontend/src/Dashboard.tsx), [frontend/src/index.css](frontend/src/index.css) | Automated filter/error tests; prior milestone desktop/mobile visual checks. No automated full-browser tenant flow is claimed. |
| Setup, permission and operational documentation | [README.md](README.md), [ENTRA_SETUP.md](ENTRA_SETUP.md), [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) | Documentation review; only environment variable names documented, no environment/credential contents copied |
| Environment, certificate, private-key, token and secret files excluded from normal Git adds | Root/frontend/backend `.gitignore` files | Synthetic Git check-ignore verification described below; tracked/history inspection unavailable without an initialized repository |

## Live acceptance record — 2026-09-23

Source: project owner report, not a live run performed during final-delivery documentation work.

1. SPA registration retained only delegated backend Assessment.Read as its resource API permission.
2. All six prior direct Graph permissions were removed from the SPA, and their old admin consent revoked from its enterprise application.
3. Backend continued using certificate-based delegated OBO with the six read-only Graph permissions.
4. A clean sign-out/sign-in followed by an assessment completed successfully.
5. Dashboard showed **10 scanner checks: PASS 2, WARN 7, FAIL 0, N/A 1**. Microsoft Secure Score was separate.
6. Defender incidents returned **HTTP 403**, correctly yielding **N/A**. This does not establish the cause of denial or the absence of threats.

These numbers are a dated observation, not hard-coded acceptance thresholds. New tenant data or permissions can legitimately change the counts. The live test establishes the working OBO path; it does not prove every service/license is available.

## Automated delivery verification

Execute in both application folders: `npm test`, `npm run lint`, `npm run build`. No live tokens or credentials are used by the test fixtures. The final results are recorded after the documentation/branding changes.

| Command | Working directory | Final result |
| --- | --- | --- |
| `npm test` | `backend` | PASS: 43 tests, 0 failures; all 30 original regressions retained |
| `npm run lint` | `backend` | PASS: clean, exit 0 |
| `npm run build` | `backend` | PASS: TypeScript compilation, exit 0 |
| `npm test` | `frontend` | PASS: 4 tests, 0 failures |
| `npm run lint` | `frontend` | PASS: clean, exit 0 |
| `npm run build` | `frontend` | PASS: TypeScript and Vite build, including redirect bridge, exit 0 |

Executed on 2026-09-23 after the substantive documentation and branding changes. The frontend retains the existing nonblocking Vite warning about `__dirname` and its future native config loader. Tests/builds were run with permission for subprocess execution outside the sandbox. No dependency install, tenant operation, certificate inspection, or live Graph request was performed for this verification. Environment/credential contents were not printed or copied; Vite consumes local public frontend configuration as part of its normal build. Result-record updates in this document do not alter runtime behavior.

The final KRN-themed signed-out page was checked in an isolated headless Edge profile at desktop width 1440 and emulated mobile width 390. Both rendered the text KRN fallback and navy theme; document scroll width equaled viewport width (no horizontal overflow). This visual check did not use the owner's signed-in browser or replay live OBO.

## Repository protection verification

The root, frontend and backend were each checked with `git rev-parse --show-toplevel`; all report **not a Git repository**. No repository was initialized or commit created in the workspace. Consequently, tracked-file and commit-history status cannot be certified.

Ignore behavior was tested in disposable repositories containing **only copies of the ignore rules**, using synthetic pathname arguments with `git check-ignore --no-index --`. Sensitive files were not opened, copied, staged, or printed. Each application's standalone ignore rules were checked separately as well as the root rules. Negative controls ensure source files and delivery documentation remain eligible for normal tracking. **PASS: each of root/frontend/backend ignored all 62 protected sample paths and allowed all 13 source/document/logo controls (186 protected-path checks and 39 controls total).** An initial PowerShell stdin-based harness attached carriage returns to filenames; it was corrected to explicit pathname arguments and rerun successfully. This was a verification-harness issue, not a change to application behavior.

Ignore coverage includes `.env` variants/backups, common certificate/private-key formats and backups, named secret/token/credential files/directories, MSAL token caches, HAR captures, dependencies, and generated builds. The rules cannot detect a credential pasted into an arbitrary source file, prevent `git add -f`, protect already-tracked history, or exclude files from an ordinary ZIP archive. These are explicit limitations, not guarantees that a commit is impossible. A future repository needs staged-file review and secret scanning before publication.

## Remaining limitations and delivery conditions

- Defender data is not currently available to the caller; N/A is accepted as correct behavior. Do not add write/application permissions or restore SPA Graph access to hide this condition.
- PIM/group expansion, effective sign-in simulation, exclusion governance, and authoritative improvement-action workflow status remain outside implemented coverage.
- Downstream interactive claims challenges and production deployment hardening remain future work.
- KRN branding uses navy/gold based on the supplied visual reference. The original logo has not been found as a local file; `frontend/public/krn-logo.png` is the optional original-asset location, with a text KRN fallback. An exact logo asset and exact brand-guide color values are not inferred from the chat image.
- No tenant configuration, authentication/OBO implementation, scope list, client secret, certificate, or environment value is changed by delivery preparation.
