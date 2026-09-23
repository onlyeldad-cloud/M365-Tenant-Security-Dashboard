# Manual Entra setup: authenticated API and certificate OBO

**Validated installation:** on 2026-09-23, the project owner confirmed successful live certificate-based OBO after a clean sign-out/sign-in. The SPA now has only delegated backend Assessment.Read; all six former direct Graph permissions and their old enterprise-application consent were removed/revoked. The assessment completed with 10 scanner checks (PASS 2, WARN 7, FAIL 0, N/A 1), with Secure Score separate and Defender HTTP 403 correctly shown as N/A. This is user-reported live evidence; automated tests use mocks.

The steps below are for a **new installation or authorized maintenance**, not instructions to repeat or replace the existing working configuration. No tenant configuration, environment values or credentials are changed by final-delivery preparation. Use actual IDs and paths from your tenant. Angle-bracket text below is a placeholder, not a value to copy literally.

## 1. Keep the existing SPA registration

In Microsoft Entra admin center → Identity → Applications → App registrations, open the existing frontend registration. Keep it single-tenant. Record its **Application (client) ID** and **Directory (tenant) ID** privately in your local configuration.

In Authentication, keep the **Single-page application** platform redirect URI exactly `http://localhost:5173/redirect.html`. Preserve the existing MSAL v5 bridge page and Vite redirect build entry. Do not enable implicit grant or add a frontend credential. This app uses MSAL's authorization-code-with-PKCE flow.

## 2. Register a separate backend API

Create a new app registration in the **same tenant**, with a descriptive name of your choosing and **Accounts in this organizational directory only**. Record its Application (client) ID. Do not reuse the SPA client ID for this registration.

The API has no interactive sign-in redirect: leave its redirect URI empty, and do not enable public-client flows.

In its Manifest, set **api.requestedAccessTokenVersion** to **2**. The server intentionally accepts v2 access tokens only; the expected audience is the backend's actual client ID, not a Graph audience or the Application ID URI string. Do not enable custom token-signing keys for the middle-tier API.

## 3. Expose the backend API

On the backend registration → **Expose an API**:

1. Set **Application ID URI** using Entra's suggested URI based on the actual backend client ID: `api://<actual-backend-application-client-id>`. If tenant policy requires a different URI, use the portal-approved URI and copy its complete scope below. The JWT audience remains the backend client ID for v2 tokens.
2. Select **Add a scope**.
3. Set **Scope name** to **Assessment.Read** (case-sensitive; this is the scope implemented by the middleware).
4. Set **Who can consent** to **Admins only**.
5. Use an admin consent display name such as **Read tenant security assessments**, and describe that this permits the application to retrieve a read-only tenant assessment on behalf of the signed-in user.
6. Set **State** to **Enabled** and save.
7. Copy the full scope identifier displayed by Entra. With the suggested URI, its template is `api://<actual-backend-application-client-id>/Assessment.Read`. This goes in the frontend's `VITE_API_SCOPE`.

## 4. Add delegated permissions and grant consent

On the **backend registration** → API permissions → Add a permission → Microsoft Graph → **Delegated permissions**, configure exactly these scanner scopes:

- `User.Read`
- `User.Read.All`
- `Policy.Read.All`
- `RoleManagement.Read.Directory`
- `SecurityEvents.Read.All`
- `SecurityIncident.Read.All`

Have an authorized tenant administrator select **Grant admin consent** for the backend's Graph delegated permissions. Do not select Application permissions or any ReadWrite scope. The backend uses certificate authentication for its own identity **inside OBO**, not an app-only/client-credentials Graph flow.

On the **SPA registration** → API permissions → Add a permission → **My APIs**, select the backend API, then **Delegated permissions → Assessment.Read**. Have an authorized administrator grant consent for that API permission too. Granting SPA-to-API consent does not grant backend-to-Graph consent; both must be completed.

The SPA no longer requests Graph scopes. **Cleanup is complete in the validated tenant:** all six direct Graph permissions were removed and their old enterprise-application admin consent revoked before the successful clean-session test. For a separate migration, review obsolete direct Graph permissions and consent separately; editing the requested-permission list alone does not necessarily revoke previously granted consent. Do not remove anything from a shared registration without reviewing its usage. Do not restore direct Graph scopes to the validated SPA.

The backend also checks the `azp` claim against `ENTRA_SPA_CLIENT_ID`. This is the existing SPA client ID. Other clients are rejected even if they can obtain a token for the API.

Supported signed-in user roles and service licenses still apply. For example, Defender incidents require a supported security-reading role and relevant service availability. A 403 or empty response cannot prove which permission, role, or license is missing. OBO cannot interactively obtain Graph consent itself.

## 5. Configure the backend certificate

Certificate credentials were practical for this project, so the implementation supports **certificates only**. No client-secret variable or fallback has been added.

Use an RSA certificate with its matching PEM private key. Store the private key **outside this repository and outside frontend/public**, with file permissions restricted to your user/backend process. For local development, you may generate a short-lived self-signed certificate yourself. For example, in a private directory of your choosing, with OpenSSL 3 installed:

```powershell
openssl req -x509 -newkey rsa:3072 -sha256 -days 90 -noenc -keyout backend-private-key.pem -out backend-certificate.pem
```

Answer the certificate subject prompts yourself. This command is an optional manual instruction; it has **not** been run by the implementation. It creates an unencrypted PEM private key, so protect it with local filesystem permissions. Never paste its contents into chat, logs, source code, frontend settings, or Entra's certificate upload. Use a PEM PKCS#8 key (`BEGIN PRIVATE KEY`) for MSAL Node.

On the **backend registration** → Certificates & secrets → **Certificates → Upload certificate**, upload **only the public certificate** (`backend-certificate.pem`). Never upload the private key. Check the certificate expiry in Entra.

Set the two backend certificate environment variables to the actual absolute file paths. The server reads them locally, verifies RSA key matching and certificate validity dates, and derives the SHA-256 thumbprint. No manual thumbprint variable is needed. It fails closed if configuration is missing or invalid, and does not print credential contents.

Before expiration, generate a replacement in a private location, upload its public certificate, update backend file paths, restart, and verify OBO. Then remove the retired public credential from Entra and securely remove the obsolete private-key file when no longer needed. At assignment completion, remove the API certificate credential and local private key if the app is no longer used. Never commit certificate or key material: root, backend, and frontend ignore files cover `.env*`, `certs/`, PEM/key/PFX/P12/CRT/CER files. Ignore patterns do not protect files that were already tracked; verify Git tracking before committing when initializing the repository.

## 6. Local environment variables — names only

`frontend/.env`:

```text
VITE_CLIENT_ID
VITE_TENANT_ID
VITE_API_SCOPE
```

The first two remain the existing SPA's public identifiers. The third is the complete scope copied from Expose an API. These are public configuration, not credentials.

`backend/.env`:

```text
ENTRA_TENANT_ID
ENTRA_API_CLIENT_ID
ENTRA_SPA_CLIENT_ID
ENTRA_CERTIFICATE_PATH
ENTRA_PRIVATE_KEY_PATH
PORT
```

`PORT` is optional; the existing default is 5000. The Vite development proxy forwards `/api` to `http://localhost:5000`; keep those aligned. The frontend origin is fixed at `http://localhost:5173`. No credential variable may begin with `VITE_`. Do not put tokens in either environment file. No values or placeholders have been written to your environment files by this change.

## 7. Start and verify manually

From `backend`, run `npm run dev`; from `frontend`, run `npm run dev`. Restart both after changing environment variables. The backend binds to localhost and needs valid configuration before it starts. `GET /api/health` is intentionally public and returns only a health status; `GET /api/assessment` is authenticated.

Sign in, select **Authorize access**, then **Run assessment**. The SPA first signs in with OpenID scopes and requests the exposed API scope explicitly for assessment access. Its browser network request is `/api/assessment`; there should be no browser Graph API call. The backend returns only assessment data, never an OBO access token. Do not copy token contents into logs or third-party decoders while verifying.

Check successful findings and N/A cases using the tenant's real permissions/licensing. Verify the popup redirect bridge and sign-out. An API 401 gets one silent renewal attempt; a persistent rejection asks the user to authorize/sign in again. Graph denials remain N/A within a successful assessment response.

## Boundaries and remaining work

- This is local development. Deployment needs HTTPS, deployment-specific origins and SPA redirect registration, routing for `/api`, secure certificate storage/rotation, and operational abuse/concurrency limits.
- MSAL's token cache stays in backend memory; no persistence or browser exposure is configured. Each provider call uses the current validated assertion. No server-side saved assessment cache is shared across users.
- Downstream Conditional Access claims challenges are sanitized and become N/A; interactive claims-challenge propagation is not implemented in this milestone.
- The current rules still do not expand PIM/group assignments, prove effective sign-in enforcement, audit exclusion approval, or claim authoritative Defender improvement-action workflow status.

Sources: [Microsoft OBO flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow), [validate audience, tenant and actor claims](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation), [expose a web API](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis), [MSAL Node certificate credentials](https://learn.microsoft.com/en-us/entra/msal/javascript/node/certificate-credentials).
