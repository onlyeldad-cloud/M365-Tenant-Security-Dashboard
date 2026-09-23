import { readFileSync } from 'node:fs';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';
import type { OnBehalfOfRequest } from '@azure/msal-node';
import type { ServerConfig } from './config.ts';
import { expectedScopes } from './graph.ts';
import type { TokenProvider } from './graph.ts';

export function createConfidentialClient(config: ServerConfig) {
  // Only local paths are configured; no credential is embedded in frontend settings.
  const certificate = new X509Certificate(readFileSync(config.certificatePath));
  const privateKey = readFileSync(config.privateKeyPath, 'utf8');
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'rsa' || !certificate.checkPrivateKey(key) ||
    Date.parse(certificate.validTo) <= Date.now() || Date.parse(certificate.validFrom) > Date.now()) {
    throw new Error('Invalid backend certificate configuration');
  }
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientCertificate: { thumbprintSha256: certificate.fingerprint256.replaceAll(':', ''), privateKey },
    },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
  });
}

export type ObOClient = { acquireTokenOnBehalfOf(request: OnBehalfOfRequest): Promise<{ accessToken: string } | null> };

/** Request-scoped provider; each call is bound to the already validated user assertion. */
export function createOboProvider(client: ObOClient, assertion: string, observeToken: (token: string) => void = () => {}): TokenProvider {
  const cache = new Map<string, Promise<string>>();
  return async (scope, forceRefresh) => {
    if (!(expectedScopes as readonly string[]).includes(scope)) throw new Error('Unsupported delegated scope');
    if (forceRefresh) cache.delete(scope);
    let pending = cache.get(scope);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await client.acquireTokenOnBehalfOf({
            oboAssertion: assertion, scopes: [`https://graph.microsoft.com/${scope}`], skipCache: forceRefresh,
          });
          if (!response?.accessToken) throw new Error('No delegated token');
          observeToken(response.accessToken);
          return response.accessToken;
        } catch {
          // Entra/MSAL errors can contain assertions or claims; never relay or log them.
          throw new Error('Delegated Graph token acquisition failed');
        }
      })();
      cache.set(scope, pending);
    }
    return pending;
  };
}
