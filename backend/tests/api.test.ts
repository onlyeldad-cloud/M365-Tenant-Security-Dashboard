import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/app.ts';
import { createTokenValidator } from '../src/auth.ts';
import { createOboProvider } from '../src/obo.ts';
import { loadConfig } from '../src/config.ts';

// These are synthetic claims and ephemeral signing keys, never tenant credentials.
const config = { tenantId: 'tenant-fixture', clientId: 'api-fixture', spaClientId: 'spa-fixture' };
const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let validate: ReturnType<typeof createTokenValidator>;
before(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey);
  validate = createTokenValidator(config, createLocalJWKSet({ keys: [{ ...jwk, kid: 'fixture-key' }] }));
});
async function token(overrides: Record<string, unknown> = {}, signingKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: config.clientId, tid: config.tenantId, azp: config.spaClientId,
    oid: 'user-fixture', ver: '2.0', scp: 'Assessment.Read', exp: now + 300, nbf: now - 10, iat: now - 10, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(signingKey);
}
async function withApi(deps: Parameters<typeof createApp>[0], work: (base: string) => Promise<void>) {
  const server = createApp(deps).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await work(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const emptyGraph = async () => json({ value: [] });
const noTokens = () => { assert.fail('Unauthenticated requests must never initiate OBO'); };

test('health is public and minimal; assessment without authentication is 401', async () => {
  await withApi({ validate, tokenProvider: noTokens }, async base => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { status: 'healthy' });
    const response = await fetch(`${base}/api/assessment`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('API rejects Graph audience, wrong issuer/tenant/caller, expired/not-yet-valid or missing expiration tokens', async () => {
  const badClaims = [
    { aud: 'https://graph.microsoft.com' }, { aud: '00000003-0000-0000-c000-000000000000' },
    { iss: 'https://untrusted.invalid' }, { tid: 'other-tenant' }, { azp: 'other-client' },
    { exp: 1 }, { exp: undefined }, { nbf: Math.floor(Date.now() / 1000) + 600 }, { ver: '1.0' },
  ];
  await withApi({ validate, tokenProvider: noTokens }, async base => {
    for (const claims of badClaims) {
      const response = await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${await token(claims)}` } });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'invalid_token', message: 'The API access token could not be validated. Sign in again.' });
    }
  });
});

test('API verifies signatures and rejects malformed bearer tokens', async () => {
  const otherKeys = await generateKeyPair('RS256');
  await withApi({ validate, tokenProvider: noTokens }, async base => {
    for (const header of ['Bearer broken', `Bearer ${await token({}, otherKeys.privateKey)}`, 'Basic fixture']) {
      assert.equal((await fetch(`${base}/api/assessment`, { headers: { Authorization: header } })).status, 401);
    }
  });
});

test('app-only, ID-like and missing-scope tokens cannot authorize assessments', async () => {
  await withApi({ validate, tokenProvider: noTokens }, async base => {
    for (const claims of [{ scp: undefined, roles: ['Assessment.Read'] }, { scp: 'Other.Scope' }, { scp: undefined }]) {
      assert.equal((await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${await token(claims)}` } })).status, 403);
    }
  });
});

test('valid API token drives OBO and assessment without returning either token', async () => {
  const apiToken = await token();
  const graphToken = 'synthetic-graph-token';
  let oboCalls = 0;
  await withApi({ validate, tokenProvider: (caller, observe) => createOboProvider({ acquireTokenOnBehalfOf: async request => {
    assert.equal(request.oboAssertion === apiToken, true);
    assert.ok(request.scopes.every(scope => scope.startsWith('https://graph.microsoft.com/')));
    oboCalls++;
    return { accessToken: graphToken };
  } }, caller.assertion, observe), graphFetch: async (_url, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('Authorization') === `Bearer ${graphToken}`, true);
    return json({ value: [] });
  } }, async base => {
    const response = await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${apiToken}`, Origin: 'http://localhost:5173' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const body = await response.text();
    assert.equal(body.includes(apiToken) || body.includes(graphToken), false);
    const result = JSON.parse(body);
    assert.equal(result.findings.length, 12);
    assert.equal(result.findings.find((f: { ruleId: string }) => f.ruleId === 'SEC-001').status, 'N/A');
    assert.equal(oboCalls, 6); // Seven collections share the same SecurityEvents scope.
  });
});

test('Graph 403 is an authenticated partial assessment with N/A, not a fabricated pass', async () => {
  await withApi({ validate, tokenProvider: () => async () => 'fixture', graphFetch: async () => json({ error: 'sensitive upstream details' }, 403) }, async base => {
    const response = await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${await token()}` } });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(body.includes('sensitive upstream details'), false);
    assert.ok(JSON.parse(body).findings.filter((f: { ruleId: string }) => f.ruleId !== 'APP-001').every((f: { status: string }) => f.status === 'N/A'));
  });
});

test('API keeps bounded Retry-After behavior for Graph 429', async () => {
  const calls = new Map<string, number>();
  const waits: number[] = [];
  await withApi({ validate, tokenProvider: () => async () => 'fixture', graphFetch: async url => {
    const key = String(url); calls.set(key, (calls.get(key) ?? 0) + 1);
    return json({}, 429, { 'Retry-After': '1' });
  }, wait: async ms => { waits.push(ms); } }, async base => {
    const response = await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${await token()}` } });
    assert.equal(response.status, 200);
    assert.ok([...calls.values()].every(count => count === 3));
    assert.equal(waits.length, 14);
    assert.ok(waits.every(delay => delay === 1000));
    assert.equal((await response.json()).resources.users.httpStatus, 429);
  });
});

test('API assessment includes later Graph pages and rejects off-origin nextLink', async () => {
  let userCalls = 0;
  await withApi({ validate, tokenProvider: () => async () => 'fixture', graphFetch: async url => {
    if (new URL(String(url)).pathname.endsWith('/users')) {
      userCalls++;
      return json({ value: [{ id: `user-${userCalls}`, userPrincipalName: 'fixture@example.test', accountEnabled: true, userType: 'Member' }],
        ...(userCalls === 1 ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?page=2' } : {}) });
    }
    return json({ value: [], '@odata.nextLink': 'https://untrusted.invalid' });
  } }, async base => {
    const result = await (await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${await token()}` } })).json();
    assert.equal(result.resources.users.data.length, 2);
    assert.equal(result.resources.organization.ok, false);
    assert.equal(userCalls, 2);
  });
});

test('OBO errors remain sanitized and response boundary strips credential fields and token echoes', async () => {
  const apiToken = await token();
  const graphToken = 'synthetic-sensitive-graph-token';
  await withApi({ validate, tokenProvider: (caller, observe) => createOboProvider({ acquireTokenOnBehalfOf: async request => {
    if (request.scopes[0]?.endsWith('/User.Read.All')) throw new Error(`secret ${apiToken}`);
    return { accessToken: graphToken };
  } }, caller.assertion, observe), graphFetch: async () => json({ value: [{ id: 'fixture', accessToken: graphToken, nested: { client_secret: 'hidden', echo: apiToken }, displayName: graphToken }] }) }, async base => {
    const response = await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${apiToken}` } });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(body.includes(apiToken) || body.includes(graphToken) || body.includes('client_secret') || body.includes('accessToken'), false);
    assert.equal(JSON.parse(body).resources.users.ok, false);
  });
});

test('CORS rejects other origins and permits only GET preflight from the local frontend', async () => {
  await withApi({ validate, tokenProvider: noTokens }, async base => {
    const denied = await fetch(`${base}/api/health`, { headers: { Origin: 'https://untrusted.invalid' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has('access-control-allow-origin'), false);
    const allowed = await fetch(`${base}/api/assessment`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-methods'), 'GET');
  });
});

test('unexpected assessment failures are sanitized', async () => {
  await withApi({ validate, tokenProvider: () => { throw new Error('sensitive credential'); }, graphFetch: emptyGraph }, async base => {
    const response = await fetch(`${base}/api/assessment`, { headers: { Authorization: `Bearer ${await token()}` } });
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes('sensitive credential'), false);
  });
});

test('OBO providers isolate users, cache only within a request, force refresh, and reject unexpected scopes', async () => {
  const calls: { assertion: string; refresh: boolean | undefined }[] = [];
  const client = { acquireTokenOnBehalfOf: async (request: { oboAssertion: string; skipCache?: boolean }) => {
    calls.push({ assertion: request.oboAssertion, refresh: request.skipCache }); return { accessToken: 'fixture' };
  } };
  const first = createOboProvider(client, 'user-a');
  const second = createOboProvider(client, 'user-b');
  await first('User.Read', false); await first('User.Read', false); await second('User.Read', false); await first('User.Read', true);
  assert.deepEqual(calls.map(call => call.assertion), ['user-a', 'user-b', 'user-a']);
  assert.equal(calls[2]?.refresh, true);
  await assert.rejects(first('Unexpected.Permission', false));
});

test('backend configuration fails closed without tenant IDs or certificate paths', () => {
  assert.throws(() => loadConfig({}), /Missing required setting/);
  assert.throws(() => loadConfig({ ENTRA_TENANT_ID: 'not-a-tenant-id' }), /Invalid identifier/);
});
