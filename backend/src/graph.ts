import type { GraphRecord, GraphResult } from './contracts.ts';
export type { GraphRecord, GraphResult } from './contracts.ts';

export const graphEndpoints = {
  organization: { path: '/organization?$select=id,displayName,verifiedDomains', scope: 'User.Read' },
  users: { path: '/users?$select=id,displayName,userPrincipalName,userType,accountEnabled', scope: 'User.Read.All' },
  roles: { path: '/directoryRoles', scope: 'RoleManagement.Read.Directory' },
  policies: { path: '/identity/conditionalAccess/policies', scope: 'Policy.Read.All' },
  secureScores: { path: '/security/secureScores', scope: 'SecurityEvents.Read.All' },
  controlProfiles: { path: '/security/secureScoreControlProfiles', scope: 'SecurityEvents.Read.All' },
  incidents: { path: '/security/incidents?$top=10', scope: 'SecurityIncident.Read.All' },
} as const;

export const expectedScopes = [
  'User.Read', 'User.Read.All', 'Policy.Read.All', 'RoleManagement.Read.Directory',
  'SecurityEvents.Read.All', 'SecurityIncident.Read.All',
] as const;
export const scannerAccess = {
  permissionType: 'delegated',
  scopes: [...new Set(Object.values(graphEndpoints).map(endpoint => endpoint.scope))],
};

export type TokenProvider = (scope: string, forceRefresh: boolean) => Promise<string>;
export const isRecord = (value: unknown): value is GraphRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const base = 'https://graph.microsoft.com/v1.0';

export function retryDelay(value: string | null, attempt: number, now = Date.now()): number {
  if (value !== null && /^\d+$/.test(value.trim())) return Number(value) * 1000;
  const date = value === null ? NaN : Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 1000 * 2 ** attempt;
}

/** GET-only transport. Tokens never leave the Graph origin or enter logs/results. */
export function createGraphService(
  getToken: TokenProvider,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  async function collection(path: string, scope: string, limit?: number): Promise<GraphResult> {
    const source = `${base}${path}`;
    const checkedAt = new Date().toISOString();
    const unavailable = (message: string, httpStatus?: number, retryAfterSeconds?: number): GraphResult =>
      ({ ok: false, data: [], source, checkedAt, message, httpStatus, retryAfterSeconds });
    let next: string | undefined = source;
    const seen = new Set<string>();
    const data: GraphRecord[] = [];
    let refreshed = false;
    while (next) {
      // Validate every nextLink before acquiring or sending a token.
      let url: URL;
      try { url = new URL(next); } catch { return unavailable('Invalid Graph pagination URL.'); }
      if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password || url.hash) {
        return unavailable('Unsafe Graph pagination URL rejected.');
      }
      if (seen.has(url.href) || seen.size >= 1000) return unavailable('Pagination incomplete; no assessment can be made.');
      seen.add(url.href);
      let token: string;
      try { token = await getToken(scope, false); }
      catch { return unavailable(`Delegated Graph access unavailable. Check backend ${scope} consent, certificate configuration, and user access.`, 401); }
      let response: Response;
      let attempts = 0;
      while (true) {
        try {
          response = await fetcher(url.href, {
            method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
          });
        } catch { return unavailable('Graph request unavailable: network failure or timeout.'); }
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          try { token = await getToken(scope, true); }
          catch { return unavailable('Session could not be renewed. Authorize access or sign in again.', 401); }
          continue;
        }
        if (response.status === 429) {
          const delay = retryDelay(response.headers.get('Retry-After'), attempts);
          // Never retry early. Long delays are surfaced for a later manual refresh.
          if (attempts >= 2 || delay > 30000) return unavailable(`Graph throttled this request. Retry after ${Math.ceil(delay / 1000)} seconds.`, 429, Math.ceil(delay / 1000));
          attempts++;
          await wait(delay);
          continue;
        }
        break;
      }
      if (!response.ok) {
        const message = response.status === 401 ? 'Authentication rejected. Sign in again.'
          : response.status === 403 ? `Access denied: check ${scope} admin consent, your role, and tenant licensing.`
          : `Graph data unavailable (HTTP ${response.status}).`;
        return unavailable(message, response.status);
      }
      if (response.status === 206) return unavailable('Graph returned partial provider data; the collection cannot be assessed as complete.', 206);
      let body: unknown;
      try { body = await response.json(); } catch { return unavailable('Graph returned an empty or invalid response.'); }
      if (!isRecord(body) || !Array.isArray(body.value) || !body.value.every(isRecord)) {
        return unavailable('Graph collection is missing or malformed.');
      }
      data.push(...body.value);
      if (limit !== undefined && data.length >= limit) return { ok: true, data: data.slice(0, limit), source, checkedAt };
      const link = body['@odata.nextLink'];
      if (link !== undefined && (typeof link !== 'string' || !link)) return unavailable('Graph pagination is malformed.');
      next = link as string | undefined;
    }
    return { ok: true, data, source, checkedAt };
  }
  return { collection };
}

export type GraphService = ReturnType<typeof createGraphService>;
