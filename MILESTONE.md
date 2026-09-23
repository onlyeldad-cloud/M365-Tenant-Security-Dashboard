# Read-only Graph dashboard

## Final delivery: live validation recorded 2026-09-23

The project owner confirmed that the live certificate-based OAuth On-Behalf-Of architecture works after the SPA permission cleanup. The SPA has only delegated backend **Assessment.Read** as its resource API permission. All six former direct Graph permissions were removed from the SPA registration and their old admin consent revoked from its enterprise application. A clean sign-out/sign-in followed by an assessment completed successfully.

| Reported live result | Value |
| --- | --- |
| Scanner checks | 10 |
| PASS | 2 |
| WARN | 7 |
| FAIL | 0 |
| N/A | 1 |
| Microsoft Secure Score | Displayed separately, excluded from scanner totals |
| Defender incidents | HTTP 403, correctly represented as N/A |

Evidence provenance: this live result and grant cleanup were reported by the project owner; final-delivery preparation does not replay tenant authentication, inspect tokens, or change tenant configuration. Defender's exact denial cause is not proven. The expected behavior is accurate N/A, not a fabricated PASS or incident finding. The counts are a snapshot and may change on future assessments.

Final handover documents are [README.md](README.md), [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md), [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md), and the updated [ENTRA_SETUP.md](ENTRA_SETUP.md). Final automated command results and repository-protection checks are recorded in ACCEPTANCE_TESTS.md. Authentication/OBO logic, the redirect bridge, permission scope list, and rule behavior are preserved.

KRN navy/gold presentation was applied at the owner's request. Status colors still distinguish PASS/WARN/FAIL/N/A. The exact original logo is not present as a local asset; the UI supports `frontend/public/krn-logo.png` and currently falls back to text KRN branding. No replacement logo was invented.

## Current architecture: milestone 3

The existing MSAL popup login, session storage, single-tenant authority, and v5 redirect bridge are preserved. The SPA now requests an **access token for the backend API**, sends it to `GET /api/assessment`, and renders the returned assessment. Express validates the signature (RS256 with tenant-specific Entra JWKS), issuer, API audience, expiry/not-before, tenant, token version, authorized SPA actor, and delegated `Assessment.Read` scope. ID/app-only/Graph-audience tokens are rejected.

MSAL Node uses a backend-only certificate credential and the validated user assertion for OAuth OBO. The GET-only Graph transport, pagination, 429 behavior, and all assessment rules now run in `backend/src`. The browser imports only the response type contract; it does not import Graph transport or rule code. Secure Score remains separate from scanner totals.

`GET /api/health` is intentionally public and minimal. CORS accepts only `http://localhost:5173`; the Vite development proxy routes `/api` to the existing backend port. Error bodies are sanitized, responses use `Cache-Control: no-store`, and an output boundary strips credential fields/token echoes. No actual tenant IDs, credentials, certificates, or environment values were created or changed.

**Live OBO is now validated, as recorded above.** [ENTRA_SETUP.md](./ENTRA_SETUP.md) remains the new-installation guide and supersedes the old SPA-direct-Graph setup below. Certificate support is used; there is no client-secret fallback. The dashboard has responsive navigation, status cards, finding details, filters, and accessible loading/error feedback.

### Files changed in milestone 3

- Moved without changing rule verdicts: `frontend/src/{graph,assessment,conditionalAccess,securityChecks}.ts` → `backend/src/`; the two existing regression test files moved to `backend/tests/` with all 30 cases retained. Strict backend TypeScript required small type-narrowing changes.
- Created: `backend/src/{app,auth,config,contracts,obo}.ts`, `backend/tests/api.test.ts`, `frontend/src/api.ts`, `frontend/tests/api.test.ts`, and `ENTRA_SETUP.md`.
- Modified: backend server, package/lockfile and tsconfig; frontend auth scope request, App, Dashboard, dashboardModel, index.css, index.html, Vite proxy; root/frontend/backend ignore files; this milestone document. The redirect bridge call and MSAL initialization are preserved; the bridge's error log now uses a static message instead of dumping an authentication error object.

### Current verification commands

Run `npm test`, `npm run lint`, and `npm run build` in **both** `frontend` and `backend`. Original rule/Graph regressions now run as backend tests. Authentication integration tests use ephemeral in-memory signing keys and mocked OBO/Graph, never live tenant tokens. Tests cover invalid audience/issuer/signature/expiry, caller and scope restrictions, CORS, authenticated assessments, denied/empty/paged/throttled Graph data, sanitized errors, and no token leakage.

Live Entra configuration and certificate OBO were subsequently validated by the project owner; Defender access still yields the accurately reported N/A. Production deployment controls and downstream interactive claims-challenge propagation remain outside this local-development milestone. Existing rule coverage limitations below still apply.

Milestone 3 local results: **43 backend tests passed** (including all 30 original regressions), **4 frontend tests passed**, both lint commands clean, and both TypeScript/production builds passed. Compiled backend API/OBO modules loaded successfully in Node 24. The existing Vite `__dirname` future-config-loader warning remained nonblocking. The signed-out UI was visually checked at desktop and mobile widths. The previously pending live OBO verification is now completed per the project owner's report above; see ACCEPTANCE_TESTS.md for the final delivery rerun.

---

The following sections document **milestones 1–2** and their rule semantics. Statements about browser-side Graph and an unused backend describe the architecture before milestone 3; use the current section and ENTRA_SETUP.md for configuration.

## Architecture review before milestone 2

| Assignment area | Current implementation | Assessment |
| --- | --- | --- |
| Backend | Node/TypeScript/Express with root and health routes only | A backend exists, but it does not host the Graph client, rules, or assessment API. |
| Authentication | MSAL v5 initialized in the SPA, popup authentication and token acquisition, redirect bridge, session storage | Fits the stated delegated single-tenant SPA architecture. Live login/consent must still be verified in the tenant. |
| Graph client | Reusable GET-only frontend service using delegated bearer tokens | Functional for a browser-based scanner. It does not satisfy a rubric that specifically requires backend Graph integration or the Graph SDK in the backend. |
| Error handling | Typed unavailable results, token renewal, access-denied handling, bounded throttling retries, timeouts, response validation | Present in the frontend; backend assessment error handling does not exist because there are no backend assessment routes. |
| Paging | Validated nextLink traversal, loop/page limits, all-or-unavailable inventory | Present; milestone 2 removes the score/incident truncation and adds paged control profiles. |

The full assignment rubric has not been supplied, so overall architecture compliance cannot be certified. If backend-hosted Graph access is required, move/proxy the assessment behind a properly authenticated backend in a separate milestone. Do not simply add a public token-forwarding endpoint or treat a Graph-audience token as authorization to this backend. Authentication/audience validation and delegated token handling would need an explicit design that respects the no-client-secret constraint. No backend redesign is made here.

## Microsoft Entra setup

In the existing app registration, add these **Microsoft Graph delegated** permissions and have an authorized administrator grant tenant consent:

- User.Read
- User.Read.All
- Policy.Read.All
- RoleManagement.Read.Directory
- SecurityEvents.Read.All
- SecurityIncident.Read.All

Keep the existing SPA redirect URI `http://localhost:5173/redirect.html` and single-tenant registration. Keep `VITE_CLIENT_ID` and `VITE_TENANT_ID` in the frontend's local environment file. These are public application configuration; never put secrets or tokens in Vite environment variables. Environment files are ignored at the root and in both projects.

Sign in, click **Authorize read access**, then **Run assessment**. Silent acquisition is performed independently per resource, so a missing permission does not suppress unrelated checks. Interactive consent only runs from the explicit button. If consent is denied, run the assessment anyway to see available data and N/A results.

Consent alone does not guarantee access: the signed-in user's supported directory/security roles and tenant service licenses also apply. Conditional Access may require the relevant Entra licensing; security APIs depend on tenant service availability. The application reports denial/unavailability as N/A and cannot diagnose a missing license conclusively from a 403.

Microsoft references: [organization properties available with User.Read](https://learn.microsoft.com/en-us/graph/api/organization-list?view=graph-rest-1.0), [role members](https://learn.microsoft.com/en-us/graph/api/directoryrole-list-members?view=graph-rest-1.0), [Conditional Access requirements](https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-list-policies?view=graph-rest-1.0), [Secure Score requirements](https://learn.microsoft.com/en-us/graph/api/security-list-securescores?view=graph-rest-1.0), [incident requirements](https://learn.microsoft.com/en-us/graph/api/security-list-incidents?view=graph-rest-1.0), [throttling guidance](https://learn.microsoft.com/en-us/graph/throttling).

## Rule semantics

| Rule | Interpretation |
| --- | --- |
| ORG-001 | PASS only when tenant ID, name, and nonempty verified domain names are available. An inventory check, not a tenant-wide security verdict. |
| USR-001 | WARN when disabled users exist; PASS when a complete, nonempty user inventory contains none. Disabled accounts are lifecycle review items. |
| USR-002 | WARN when guest accounts exist; PASS when a complete, nonempty user inventory contains none. |
| ROL-001 | WARN for a complete, nonempty activated role inventory requiring review. This conservative inventory does not classify individual roles or evaluate all privilege assignments. |
| ROL-002 | FAIL above four direct Global Administrator users; WARN for one to four. This is an assignment project threshold, not a Microsoft compliance standard. Empty, missing, or non-user membership returns N/A. |
| CA-001 | PASS only for enabled, mandatory MFA (or an authentication strength proven to satisfy MFA), all apps, modern clients, no exclusions or additional restrictions, and either all users or every inventoried activated role template plus Global Administrator. Role coverage can combine qualifying policies. Partial coverage is WARN; no enforcing MFA is FAIL. Missing/unknown policy or required role data is N/A. |
| CA-002 | PASS only when enabled block policies jointly cover both exchangeActiveSync and other legacy clients, all users/apps, without restrictions or exclusions. Partial blocking is WARN; no enabled block is FAIL. Empty/malformed/inaccessible policy data is N/A. |
| CA-003 | WARN for explicit exclusions in enabled or report-only policies, including users, groups, roles, guests, apps, locations, platforms, or exclusion filters. PASS means no explicit exclusions in those inspected conditions, not proof that inclusions cover everyone. Only disabled policies, empty data, or missing fields are N/A. |
| DEF-001 | FAIL for active/inProgress high-severity incidents; WARN for other open incidents; PASS only for a complete, nonempty inventory with no open incidents. Empty, denied, partial, or unknown status/severity data is N/A. Coverage is limited to caller visibility and Defender retention. |
| APP-001 | Checks the local scanner configuration requests exactly the six expected delegated read-only scopes. It does not claim to audit the Entra registration or actual grants. Configuration drift is FAIL. |

### Separate Microsoft readouts

SEC-001 and SEC-002 use the finding schema but are marked `category: microsoft`, rendered separately, and excluded from scanner status cards and filters. There are **10 scanner checks and 2 Microsoft readouts**. A PASS in these readouts is an availability/result-state indication, never the scanner's security verdict.

- **SEC-001:** Read all returned Secure Score pages and select the newest valid `createdDateTime`; `$orderby` is not assumed to be supported. Missing, empty, ambiguous, invalid, future-dated, or stale data is N/A. A documented project freshness threshold of 72 hours applies to daily snapshots; this is not a Microsoft SLA. A real numeric score of zero is displayed only when Graph actually returns it in a valid current snapshot.
- **SEC-002:** GET `/security/secureScoreControlProfiles` with the existing `SecurityEvents.Read.All` scope. Match current snapshot `controlName` values to profile IDs. Nondeprecated controls with a score gap and a latest recorded `Default` state are listed as current improvement candidates (WARN). Fully scored, deprecated, Ignored, Reviewed, or ThirdParty controls are documented separately. A complete match with no Default-state gaps reports PASS for this readout only. Missing endpoints, empty collections, incomplete matches, unknown state/history, and unavailable snapshots are N/A. Profiles without a matching current snapshot control are not assumed to be applicable or open. This is a conservative derivation from score/profile data, not an assertion of Defender portal workflow status.

Conditional Access evaluation checks configuration, not actual enforcement during a sign-in. Report-only/disabled policies cannot establish protection. OR grants with a non-MFA alternative cannot establish required MFA. Authentication strength IDs alone do not establish MFA; an available `requirementsSatisfied: mfa` is required. Narrow user/group/app/client/risk/location/device/flow conditions prevent broad-coverage PASS. The scanner does not infer that emergency-access exclusions are automatically unjustified, expand excluded group membership, audit service-level legacy authentication controls, or simulate effective Conditional Access.

Every rule returns N/A when its required source/fields are unavailable. ROL-002 uses the built-in Global Administrator role template ID to resolve the tenant-specific role, then GETs `/directoryRoles/{id}/members`. Group expansion, PIM eligibility, and emergency-access readiness require a later milestone. Activated directory roles do not constitute a complete PIM privilege audit.

All seven Graph collections (organization, users, roles, policies, Secure Score, control profiles, and incidents), plus Global Administrator membership, follow pagination. Failed or unsafe pages discard partial data. Incident `$top=10` is a page size, not an assessment limit; a high-severity incident on a later page is included. Score history is paged to select the newest dated snapshot. HTTP 206 partial provider responses are unavailable rather than treated as complete evidence.

The transport exposes only GET, rejects off-origin pagination and redirects, uses 30-second request timeouts, renews a 401 token once, and retries 429 responses at most twice. Retry-After supports seconds or HTTP dates; absent headers use exponential backoff. Delays above 30 seconds are surfaced as N/A with the requested delay for a later manual refresh, rather than retrying early. Raw Graph/auth error bodies and tokens are never logged or included in findings. Tenant evidence is shown only in the signed-in dashboard and is not persisted by the service.

## Verification

Use Node 24 (the tests use native TypeScript stripping).

```powershell
cd frontend
npm test
npm run lint
npm run build
cd ../backend
npm run build
```

Tests use mocked Graph responses and cover GET enforcement, pagination, token renewal, permission denial, Retry-After, unavailable/empty/malformed data, rule statuses, partial consent, and the endpoint/member request orchestration. Live tenant login, consent, licensing, and data must be verified using the browser; automated tests do not establish those.

Milestone 2 preserves the original five rule evaluations and transport regression cases. The existing orchestration test now expects the additional profile endpoint, complete score/incident paging, and twelve findings. Additional tests cover every new rule, CA coverage/exclusion edge cases, authentication strengths, snapshot freshness, control state history, Defender visibility, local permission configuration, dashboard filter combinations, and separation of Microsoft readouts from scanner summaries.

The dashboard has status cards, combined status/severity filters, expandable finding details (evidence, recommendation, source, query timestamp), loading and error states, and source-specific unavailability. Changing filters does not change totals. Raw evidence is React-escaped text; it is never rendered as HTML.

### Remaining verification and scope

- Verify the backend requirement against the full assignment rubric; backend assessment integration remains unimplemented if required.
- Validate authentication, admin consent, source permissions/licenses, and dashboard interactions in the real tenant. No live tenant/API or browser end-to-end result is claimed by the mocked tests.
- PIM eligibility, group-expanded role membership, effective CA/sign-in coverage, exclusion governance, and authoritative portal improvement-action workflow status remain outside current coverage.
- APP-001 does not inspect Entra app registration grants. Review additional grants manually without extending the scanner's six-scope permission set.

No new Entra permissions, redirect URIs, application credentials, or client secrets are required for milestone 2. All six planned scopes must remain **Delegated**, with appropriate consent and a supported signed-in user role/service entitlement. A denied API response does not prove which entitlement is missing.

Additional API references: [Conditional Access grant operators](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessgrantcontrols?view=graph-rest-1.0), [policy conditions](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessconditionset?view=graph-rest-1.0), [authentication strength MFA claims](https://learn.microsoft.com/en-us/graph/api/resources/authenticationstrengthpolicy?view=graph-rest-1.0), [control profiles](https://learn.microsoft.com/en-us/graph/api/security-list-securescorecontrolprofiles?view=graph-rest-1.0), [control state history](https://learn.microsoft.com/en-us/graph/api/resources/securescorecontrolstateupdate?view=graph-rest-1.0).

The backend build configuration now emits CommonJS into `dist`, matching its existing package type and `npm start` command. The frontend's existing Vite configuration may emit a future native-config-loader warning about `__dirname`; it does not prevent the build.
