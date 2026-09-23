// Original transport and rule regressions now run beside the backend engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphService, retryDelay } from '../src/graph.ts';
import type { GraphResult } from '../src/graph.ts';
import { assess, evaluate } from '../src/assessment.ts';
import type { Assessment } from '../src/assessment.ts';

const response = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const ok = (data: GraphResult['data']): GraphResult => ({ ok: true, data, source: 'test-source', checkedAt: '2026-01-01T00:00:00Z' });
const user = { id: 'user-fixture', userPrincipalName: 'example@example.test', userType: 'Member', accountEnabled: true };
const role = { id: 'role-fixture', displayName: 'Global Administrator', roleTemplateId: '62e90394-69f5-4237-9190-012177145e10' };
function fixtures(): Assessment['resources'] {
  return { organization: ok([{ id: 'org-fixture', displayName: 'Example', verifiedDomains: [{ name: 'example.test' }] }]),
    users: ok([user]), roles: ok([role]), policies: ok([]), secureScores: ok([]), controlProfiles: ok([]), incidents: ok([]) };
}
const member = { ...user, '@odata.type': '#microsoft.graph.user' };

test('GET-only transport follows all user pages', async () => {
  const calls: string[] = [];
  const service = createGraphService(async () => 'test-token', async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    return calls.length === 1 ? response({ value: [user], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=next' }) : response({ value: [{ ...user, id: 'second' }] });
  });
  const result = await service.collection('/users', 'User.Read.All');
  assert.equal(result.data.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(result).includes('test-token'), false);
});

test('untrusted pagination never receives tokens or requests', async () => {
  let requests = 0;
  const service = createGraphService(async () => 'test-token', async () => {
    requests++;
    return response({ value: [user], '@odata.nextLink': 'https://example.test/steal' });
  });
  const result = await service.collection('/users', 'User.Read.All');
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, []);
  assert.equal(requests, 1);
});

test('401 refreshes once and persistent rejection is unavailable', async () => {
  const refreshes: boolean[] = [];
  const service = createGraphService(async (_scope, refresh) => { refreshes.push(refresh); return 'test-token'; }, async () => response({}, 401));
  const result = await service.collection('/users', 'User.Read.All');
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(result.httpStatus, 401);
  assert.equal(result.ok, false);
});

test('401 can recover with a refreshed token', async () => {
  let calls = 0;
  const service = createGraphService(async () => 'test-token', async () => ++calls === 1 ? response({}, 401) : response({ value: [user] }));
  assert.equal((await service.collection('/users', 'User.Read.All')).ok, true);
});

test('429 honors Retry-After, retries boundedly, and surfaces long waits', async () => {
  const waits: number[] = [];
  let calls = 0;
  const service = createGraphService(async () => 'test-token', async () => {
    calls++;
    return response({}, 429, { 'Retry-After': '2' });
  }, async ms => { waits.push(ms); });
  const result = await service.collection('/users', 'User.Read.All');
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(calls, 3);
  assert.equal(result.httpStatus, 429);
  const long = createGraphService(async () => 'test-token', async () => response({}, 429, { 'Retry-After': '120' }), async () => { assert.fail('Must not retry early'); });
  assert.equal((await long.collection('/users', 'User.Read.All')).retryAfterSeconds, 120);
  assert.equal(retryDelay('Thu, 01 Jan 2026 00:00:10 GMT', 0, Date.parse('2026-01-01T00:00:00Z')), 10000);
  assert.equal(retryDelay(null, 1), 2000);
});

test('403 and failed subsequent pages discard incomplete inventories', async () => {
  let calls = 0;
  const service = createGraphService(async () => 'test-token', async () => ++calls === 1
    ? response({ value: [user], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?page=2' }) : response({}, 403));
  const result = await service.collection('/users', 'User.Read.All');
  assert.equal(result.httpStatus, 403);
  assert.deepEqual(result.data, []);
  const resources = fixtures();
  resources.users = result;
  assert.deepEqual(evaluate(resources, ok([member])).filter(f => f.ruleId.startsWith('USR')).map(f => f.status), ['N/A', 'N/A']);
});

test('missing, malformed, empty, and unavailable responses never produce PASS', async () => {
  for (const body of [{}, { value: null }, { value: [null] }]) {
    const service = createGraphService(async () => 'test-token', async () => response(body));
    assert.equal((await service.collection('/users', 'User.Read.All')).ok, false);
  }
  for (const fetcher of [async () => new Response(null, { status: 204 }), async () => { throw new Error('offline'); }]) {
    const service = createGraphService(async () => 'test-token', fetcher);
    assert.equal((await service.collection('/users', 'User.Read.All')).ok, false);
  }
  const empty = fixtures();
  for (const key of Object.keys(empty) as (keyof typeof empty)[]) empty[key] = ok([]);
  assert.ok(evaluate(empty, ok([])).every(f => f.status === 'N/A'));
  const limited = fixtures();
  limited.users = ok([{ id: 'limited', accountEnabled: null, userType: null }]);
  assert.ok(evaluate(limited, ok([{ id: 'limited' }])).filter(f => f.ruleId !== 'ORG-001' && f.ruleId !== 'ROL-001').every(f => f.status === 'N/A'));
});

test('rules distinguish observed evidence, review items, and excessive direct administrators', () => {
  const resources = fixtures();
  assert.deepEqual(evaluate(resources, ok([member])).map(f => f.status), ['PASS', 'PASS', 'PASS', 'WARN', 'WARN']);
  resources.users = ok([{ ...user, userType: 'Guest', accountEnabled: false }]);
  const findings = evaluate(resources, ok(Array.from({ length: 5 }, (_, i) => ({ ...member, id: String(i) }))));
  assert.deepEqual(findings.map(f => f.status), ['PASS', 'WARN', 'WARN', 'WARN', 'FAIL']);
  assert.equal(findings.length, 5);
  assert.equal(evaluate(resources, ok([{ id: 'group', '@odata.type': '#microsoft.graph.group' }]))[4].status, 'N/A');
});

test('assessment calls all seven endpoints, pages score/incidents, and resolves GA members', async () => {
  const urls: string[] = [];
  const service = createGraphService(async () => 'test-token', async url => {
    const path = new URL(String(url)).pathname;
    urls.push(String(url));
    if (path.endsWith('/members')) return response({ value: [member] });
    if (path.endsWith('/directoryRoles')) return response({ value: [role] });
    if (path.endsWith('/secureScores')) return String(url).includes('page=2') ? response({ value: [{ currentScore: 15, maxScore: 20 }] })
      : response({ value: [{ currentScore: 10, maxScore: 20 }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/security/secureScores?page=2' });
    if (path.endsWith('/incidents')) return String(url).includes('page=2') ? response({ value: [{ id: 'late', status: 'active', severity: 'high' }] })
      : response({ value: Array.from({ length: 10 }, (_, id) => ({ id: String(id), status: 'resolved', severity: 'low' })), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/security/incidents?page=2' });
    return response({ value: [] });
  });
  const result = await assess(service);
  assert.equal(urls.length, 10);
  assert.equal(result.globalAdmins.data.length, 1);
  assert.equal(result.resources.secureScores.data.length, 2);
  assert.equal(result.resources.incidents.data.length, 11);
  assert.equal(result.findings.length, 12);
  assert.equal(result.findings.find(f => f.ruleId === 'DEF-001')?.status, 'FAIL');
});

test('silent token failure makes only the affected source unavailable', async () => {
  const service = createGraphService(async scope => { if (scope === 'User.Read.All') throw new Error('consent required'); return 'test-token'; }, async () => response({ value: [] }));
  const result = await assess(service);
  assert.equal(result.resources.users.ok, false);
  assert.equal(result.resources.organization.ok, true);
});
