# Microsoft 365 Tenant Security Dashboard: demonstration script

**Target duration: 7 minutes**, with up to one minute for sign-in and network delays. Follow the sections in order. This demonstration reads existing configuration and data; it does not change permissions or tenant settings.

Before presenting, start the frontend and backend using [README.md](README.md). Prepare the dashboard, README architecture diagram, and [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) in separate tabs. Close `.env` tabs and terminals showing configuration. Keep developer tools, authorization headers, certificate files, private keys, tokens, and credentials off screen. Show tenant/user evidence only to an authorized audience; use approved redacted material for public recordings.

## 1. Architecture — 0:00–0:45

**What I should show on screen:** The architecture diagram in README.

**What I should say:**

> “This dashboard gives a read-only view of Microsoft 365 tenant security. React signs the user in and requests an access token for our Express API. The backend validates the token's signature, issuer, audience, and lifetime, along with the tenant, calling SPA, and delegated scope. It then uses certificate-based On-Behalf-Of authentication to request a delegated Microsoft Graph token. Graph access and assessment logic run on the backend, and the dashboard receives assessment results.”

**Expected result:** The audience can follow SPA → protected API → certificate-based OBO → Microsoft Graph → assessment engine → dashboard.

**Important security point:** A Graph token is not accepted as backend authentication. Graph tokens and the backend private key are never returned to React. Graph operations are GET-only.

## 2. Entra permissions and least privilege — 0:45–1:25

**What I should show on screen:** The SPA and backend tables in PERMISSION_MATRIX. If using the Entra portal, show only the existing permission lists, with identifiers hidden; do not edit or grant anything.

**What I should say:**

> “The SPA has only Assessment.Read for our backend API. Its former direct Graph permissions and their old consent were removed, and a clean sign-in assessment succeeded afterward. The backend has six delegated read-only Graph permissions: User.Read, User.Read.All, Policy.Read.All, RoleManagement.Read.Directory, SecurityEvents.Read.All, and SecurityIncident.Read.All. The matrix explains which checks need each permission. Delegated access also depends on the signed-in user's access and service availability.”

**Expected result:** Clear separation between SPA-to-backend authorization and backend-to-Graph access.

**Important security point:** No Graph application permissions, ReadWrite scopes, or client secrets are used. Certificate authentication does not turn delegated OBO into application-permission access. APP-001 checks local scope configuration, not actual Entra grants.

## 3. Sign in — 1:25–1:50

**What I should show on screen:** The signed-out KRN dashboard, then select **Sign in with Microsoft**. Pause screen sharing while entering authentication factors if necessary.

**What I should say:**

> “I sign in with an authorized organizational account through Microsoft. The application keeps its existing MSAL popup flow and redirect bridge. Once sign-in completes, the authenticated dashboard becomes available.”

**Expected result:** The dashboard shows the signed-in account and assessment controls. An existing Microsoft session may complete the popup without another password prompt.

**Important security point:** Authentication takes place through Microsoft; do not display passwords, MFA codes, or token contents.

## 4. Authorize access — 1:50–2:15

**What I should show on screen:** Select **Authorize access**, then show the read-access-authorized message.

**What I should say:**

> “This action requests access to our backend's Assessment.Read scope. It does not request direct Graph access for the SPA. Administrator consent is already configured, so a new consent screen may not appear.”

**Expected result:** “Read access authorized. Run the assessment to load data.” If authorization fails, show the sanitized message and stop the live path rather than changing consent during the presentation.

**Important security point:** The SPA token is intended for our backend API. Do not add permissions or change tenant configuration to make the demo proceed.

## 5. Run assessment — 2:15–2:50

**What I should show on screen:** Select **Run assessment**. Point out the progress indicator and completion message.

**What I should say:**

> “The browser calls the protected assessment endpoint. The backend acquires delegated Graph access, reads the required collections, and evaluates the checks. Pagination follows validated Graph links. Throttling honors Retry-After with bounded retries, so unavailable data can be reported without retrying forever.”

**Expected result:** Loading feedback followed by tenant information, findings, separate Microsoft readouts, and any source-availability notices. The button becomes **Refresh assessment**.

**Important security point:** The scanner does not remediate settings or make Graph writes. Errors are sanitized, and incomplete data cannot establish a PASS.

## 6. Explain the 10 scanner checks — 2:50–3:30

**What I should show on screen:** **Assessment at a glance**, the tenant name, and the PASS / WARN / FAIL / N/A cards.

**What I should say:**

> “There are ten scanner checks: tenant metadata, disabled users, guests, directory roles, Global Administrators, three Conditional Access checks, Defender incidents, and scanner permission configuration. PASS means that check's criteria were met, WARN means review is recommended, FAIL means an evaluated criterion failed, and N/A means Not Checkable. These are evidence-based checks, not a tenant-wide compliance certificate.”

**Expected result:** Ten scanner checks, with the four status counts totaling ten. The owner-reported live snapshot on 2026-09-23 was **PASS 2, WARN 7, FAIL 0, N/A 1**. Read the current counts aloud; do not promise the historical values will recur.

**Important security point:** WARN does not automatically mean a vulnerability; for example, guest and disabled accounts require contextual review. Zero FAIL findings does not prove the tenant is secure.

## 7. Open a finding — 3:30–4:20

**What I should show on screen:** An appropriate finding, preferably CA-001 or CA-003, then **View details for** that rule. Point to its explanation, recommendation, evidence, source, and query/check timestamp.

**What I should say:**

> “Each finding explains why it received its status. The evidence shows what the assessment used, the recommendation describes a review action, and the source and timestamp make the result traceable. Conditional Access checks inspect configuration; they do not simulate effective enforcement during an actual sign-in. Exclusions may have legitimate purposes and need administrator review.”

**Expected result:** Expanded details show the finding's evidence and recommendation alongside its source and timestamp. Explain the actual returned status, including N/A if that is the result.

**Important security point:** Recommendations are advisory and never applied automatically. Evidence can contain tenant and user information; avoid exposing it outside the authorized audience.

## 8. Filter findings — 4:20–4:50

**What I should show on screen:** Set **Status** to WARN, then select a severity present in the results. Point out the visible count, then select **Clear filters**.

**What I should say:**

> “Status and severity filters help focus the review. They work together, and the visible count changes with the selection. The summary cards still describe the full assessment. Clear filters restores all scanner findings.”

**Expected result:** Matching findings appear; an empty combination shows “No findings match these filters.” Summary totals remain unchanged.

**Important security point:** Filtering changes presentation only. It does not delete findings, rerun checks, or change tenant data.

## 9. Microsoft Secure Score — 4:50–5:30

**What I should show on screen:** The **Microsoft Secure Score** section and SEC-001 / SEC-002 details.

**What I should say:**

> “Microsoft Secure Score is separate from our ten scanner checks. SEC-001 reads the latest usable score snapshot. SEC-002 derives improvement candidates from score and control-profile data; it is not an authoritative view of the Defender portal's action workflow. Neither readout changes the scanner summary.”

**Expected result:** Available score evidence and improvement candidates, or an accurate N/A explanation. Empty or unusable score data produces N/A, never an invented zero or PASS. A zero is valid only when returned in a usable snapshot.

**Important security point:** A PASS on a Microsoft readout indicates its availability/result-state criteria, not a scanner security verdict or proof of complete protection.

## 10. Show N/A handling — 5:30–6:15

**What I should show on screen:** Filter scanner status to **N/A**, open DEF-001 if unavailable, and point to the source-availability notice or **Data sources** section.

**What I should say:**

> “In the validated live run, Defender incidents returned HTTP 403. The dashboard correctly reported N/A because it could not assess that source. A denial can relate to permissions, the user's role, licensing, or service availability; the response does not prove which cause applies. It also does not mean there are no incidents. Missing evidence is never treated as a successful security check.”

**Expected result:** If Defender still returns 403, DEF-001 is N/A with a sanitized explanation. If access has changed, describe today's result and use the explicitly labeled historical snapshot in MILESTONE to explain the earlier case. Do not manufacture a denial or alter configuration.

**Important security point:** Unavailable or empty security data must not be presented as a clean bill of health. Do not restore SPA Graph permissions to bypass a backend denial.

## 11. Briefly show README and permission matrix — 6:15–7:00

**What I should show on screen:** README setup, verification commands, and limitations; then the permission-to-check mapping in PERMISSION_MATRIX. Optionally point to [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md).

**What I should say:**

> “The handover includes setup, certificate lifecycle, troubleshooting, and security limitations. The permission matrix maps each backend permission to its dependent checks and keeps the SPA scope separate. The recorded delivery verification passed 43 backend tests and four frontend tests, with lint and builds passing in both projects. Automated tests use mocks; live OBO validation was separately reported by the project owner. Further work includes broader privilege coverage and production deployment hardening.”

**Expected result:** The audience can locate installation instructions, verification evidence, permission rationale, and known limitations without opening environment or credential files.

**Important security point:** Documentation contains variable names, not real configuration values or credentials. The scanner does not cover every PIM/group-based assignment or prove effective Conditional Access, and local-development validation is not production certification.

---

**If the live demo is delayed:** Allow up to one additional minute for authentication or assessment. If it cannot complete, show the sanitized error, continue with the documentation, and clearly label any approved prior evidence as historical. Do not claim a failed run succeeded, repeatedly refresh through throttling, or change authentication, permissions, or tenant settings during the demo.
