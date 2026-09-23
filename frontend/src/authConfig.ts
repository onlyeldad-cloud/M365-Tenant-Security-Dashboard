import type { Configuration, PopupRequest } from "@azure/msal-browser";

const clientId = import.meta.env.VITE_CLIENT_ID;
const tenantId = import.meta.env.VITE_TENANT_ID;

if (!clientId || !tenantId) {
  throw new Error(
    "Missing VITE_CLIENT_ID or VITE_TENANT_ID environment variable."
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: "http://localhost:5173/redirect.html",
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

export const loginRequest: PopupRequest = {
  scopes: ["openid", "profile"],
};

// Public API scope identifier only. Backend credentials never belong in Vite.
export const apiScope = import.meta.env.VITE_API_SCOPE as string | undefined;
