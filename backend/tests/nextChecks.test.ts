import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConditionalAccess } from '../src/conditionalAccess.ts';
import { currentScore, evaluateSecurity, evaluateScannerPermissions } from '../src/securityChecks.ts';
import { createGraphService, expectedScopes, scannerAccess } from '../src/graph.ts';
import type { GraphResult } from '../src/graph.ts';
import { filterFindings, summarize } from '../../frontend/src/dashboardModel.ts';

const now = Date.parse('2026-09-22T12:00:00Z');
const ok = (data: GraphResult['data']): GraphResult => ({ ok: true, data, source: 'https://graph.microsoft.com/v1.0/test', checkedAt: new Date(now).toISOString() });
const unavailable = (status: number): GraphResult => ({ ...ok([]), ok: false, httpStatus: status, message: `Graph unavailable (HTTP ${status})` });
const ga = '62e90394-69f5-4237-9190-012177145e10';
const roles = ok([{ roleTemplateId: ga }, { roleTemplateId: 'other-role-fixture' }]);
function policy() {
  return {
    id: 'policy-fixture', displayName: 'Policy fixture', state: 'enabled',
    conditions: {
      users: { includeUsers: ['All'], includeGroups: [], includeRoles: [], excludeUsers: [], excludeGroups: [], excludeRoles: [] },
      applications: { includeApplications: ['All'], excludeApplications: [] },
      clientAppTypes: ['all'], signInRiskLevels: [], userRiskLevels: [],
    },
    grantControls: { operator: 'AND', builtInControls: ['mfa'], customAuthenticationFactors: [], termsOfUse: [] },
  };
}
const ca = (policies: GraphResult['data'], roleResult = roles) => evaluateConditionalAccess(ok(policies), roleResult);
const score = () => ({ id: 'score-fixture', createdDateTime: '2026-09-22T00:00:00Z', currentScore: 10, maxScore: 20,
  controlScores: [{ controlName: 'control-fixture', score: 2 }] });
const profile = () => ({ id: 'control-fixture', title: 'Example improvement', remediation: 'Review configuration', maxScore: 5, deprecated: false,
  controlStateUpdates: [{ state: 'Default', updatedDateTime: '2026-09-21T00:00:00Z' }] });
const resources = () => ({ secureScores: ok([score()]), controlProfiles: ok([profile()]), incidents: ok([{ id: 'incident-fixture', status: 'resolved', severity: 'high' }]) });

test('CA-001 requires enabled MFA across all apps and modern clients; role coverage can combine policies', () => {
  assert.equal(ca([policy()])[0].status, 'PASS');
  const first = policy();
  first.conditions.users.includeUsers = [];
  first.conditions.users.includeRoles = [ga];
  assert.equal(ca([first])[0].status, 'WARN');
  const second = policy();
  second.id = 'second-policy';
  second.conditions.users.includeUsers = [];
  second.conditions.users.includeRoles = ['other-role-fixture'];
  assert.equal(ca([first, second])[0].status, 'PASS');
  assert.equal(ca([first], unavailable(403))[0].status, 'N/A');
  assert.equal(ca([policy()], unavailable(403))[0].status, 'PASS'); // All users needs no role lookup.
});

test('CA-001 disabled and report-only MFA do not enforce protection', () => {
  for (const state of ['disabled', 'enabledForReportingButNotEnforced']) {
    assert.equal(ca([{ ...policy(), state }])[0].status, 'FAIL');
  }
});

test('CA-001 OR controls with a non-MFA alternative cannot pass; AND and sole MFA can', () => {
  const p = policy();
  p.grantControls.operator = 'OR';
  assert.equal(ca([p])[0].status, 'PASS');
  p.grantControls.builtInControls.push('compliantDevice');
  assert.equal(ca([p])[0].status, 'FAIL');
  p.grantControls.operator = 'AND';
  assert.equal(ca([p])[0].status, 'PASS');
  p.grantControls.operator = 'OR';
  p.grantControls.builtInControls = ['mfa'];
  assert.equal(ca([{ ...p, grantControls: { ...p.grantControls, termsOfUse: ['terms-fixture'] } }])[0].status, 'FAIL');
});

test('CA-001 authentication strengths require a proven MFA claim, not just an ID', () => {
  const p = policy();
  p.grantControls.builtInControls = [];
  assert.equal(ca([{ ...p, grantControls: { ...p.grantControls, authenticationStrength: { requirementsSatisfied: 'mfa' } } }])[0].status, 'PASS');
  assert.equal(ca([{ ...p, grantControls: { ...p.grantControls, authenticationStrength: { id: 'unknown-fixture' } } }])[0].status, 'N/A');
  assert.equal(ca([{ ...p, grantControls: { ...p.grantControls, authenticationStrength: { requirementsSatisfied: 'none' } } }])[0].status, 'FAIL');
});

test('CA-001 narrowed apps, clients, groups, risk, locations, platforms, or devices cannot establish broad coverage', () => {
  const p = policy();
  const cases = [
    { applications: { includeApplications: ['app-fixture'], excludeApplications: [] } },
    { clientAppTypes: ['browser'] },
    { users: { ...p.conditions.users, includeUsers: [], includeGroups: ['group-fixture'] } },
    { signInRiskLevels: ['high'] },
    { locations: { includeLocations: ['location-fixture'], excludeLocations: [] } },
    { platforms: { includePlatforms: ['windows'], excludePlatforms: [] } },
    { devices: { deviceFilter: { mode: 'include', rule: 'device.isCompliant -eq True' } } },
    { authenticationFlows: { transferMethods: 'deviceCodeFlow' } },
  ];
  for (const conditions of cases) assert.equal(ca([{ ...p, conditions: { ...p.conditions, ...conditions } }])[0].status, 'WARN');
});

test('CA exclusions never permit CA-001 PASS; CA-003 flags users, roles, groups, apps, locations, guests and device exclusions', () => {
  const p = policy();
  const cases = [
    { users: { ...p.conditions.users, excludeUsers: ['break-glass-fixture'] } },
    { users: { ...p.conditions.users, excludeGroups: ['group-fixture'] } },
    { users: { ...p.conditions.users, excludeRoles: [ga] } },
    { users: { ...p.conditions.users, excludeGuestsOrExternalUsers: { guestOrExternalUserTypes: 'internalGuest' } } },
    { applications: { includeApplications: ['All'], excludeApplications: ['app-fixture'] } },
    { locations: { includeLocations: ['All'], excludeLocations: ['AllTrusted'] } },
    { devices: { deviceFilter: { mode: 'exclude', rule: 'device.isCompliant -eq True' } } },
  ];
  for (const conditions of cases) {
    const findings = ca([{ ...p, conditions: { ...p.conditions, ...conditions } }]);
    assert.equal(findings[0].status, 'WARN');
    assert.equal(findings[2].status, 'WARN');
  }
  const excluded = { ...p, conditions: { ...p.conditions, users: { ...p.conditions.users, excludeUsers: ['fixture'] } } };
  assert.equal(ca([{ ...excluded, state: 'enabledForReportingButNotEnforced' }])[2].status, 'WARN');
  assert.equal(ca([p, { ...excluded, state: 'disabled' }])[2].status, 'PASS');
});

test('CA-002 requires enforced block for both legacy categories, possibly across policies', () => {
  const p = policy();
  p.grantControls.builtInControls = ['block'];
  p.conditions.clientAppTypes = ['exchangeActiveSync', 'other'];
  assert.equal(ca([p])[1].status, 'PASS');
  p.conditions.clientAppTypes = ['exchangeActiveSync'];
  assert.equal(ca([p])[1].status, 'WARN');
  assert.equal(ca([p, { ...p, id: 'second', conditions: { ...p.conditions, clientAppTypes: ['other'] } }])[1].status, 'PASS');
  assert.equal(ca([{ ...p, state: 'enabledForReportingButNotEnforced' }])[1].status, 'FAIL');
  p.conditions.clientAppTypes = ['all'];
  p.conditions.users.excludeUsers = ['exception-fixture'];
  assert.equal(ca([p])[1].status, 'WARN');
  assert.equal(ca([policy()])[1].status, 'FAIL');
});

test('CA rules return N/A on empty, denied, or malformed policy data without throwing', () => {
  for (const result of [ok([]), unavailable(401), unavailable(403), unavailable(429), ok([{ id: 'only-id' }]), ok([{ ...policy(), conditions: null }])]) {
    assert.ok(evaluateConditionalAccess(result, roles).every(f => f.status === 'N/A'));
  }
  const p = policy();
  assert.equal(ca([{ ...p, conditions: { ...p.conditions, users: { includeUsers: ['All'] } } }])[0].status, 'N/A');
  assert.equal(ca([{ ...p, grantControls: undefined }])[0].status, 'N/A');
  assert.equal(ca([{ ...p, state: 'future-state' }])[2].status, 'N/A');
  assert.equal(ca([{ ...p, state: 'disabled' }])[2].status, 'N/A');
  assert.equal(ca([{ ...p, conditions: { ...p.conditions, clientAppTypes: ['unknownFutureValue'] } }])[0].status, 'N/A');
  assert.equal(ca([{ ...p, grantControls: { ...p.grantControls, builtInControls: ['unknownFutureValue'] } }])[0].status, 'N/A');
  assert.equal(ca([{ ...p, grantControls: { ...p.grantControls, builtInControls: [] } }])[0].status, 'N/A');
});

test('SEC-001 selects the newest dated snapshot, including a real zero score', () => {
  const data = resources();
  data.secureScores = ok([{ ...score(), currentScore: 5, createdDateTime: '2026-09-21T00:00:00Z' }, { ...score(), currentScore: 0 }]);
  const findings = evaluateSecurity(data, now);
  assert.equal(findings[0].status, 'PASS');
  assert.equal(currentScore(data.secureScores, now).score?.currentScore, 0);
  assert.equal(findings[0].category, 'microsoft');
});

test('SEC-001 empty, stale, future, undated, ambiguous or invalid snapshots are N/A, never synthesized as zero', () => {
  const cases = [ok([]), unavailable(403), ok([{ ...score(), createdDateTime: '2026-09-01T00:00:00Z' }]),
    ok([{ ...score(), createdDateTime: '2026-10-01T00:00:00Z' }]), ok([{ ...score(), createdDateTime: null }]),
    ok([score(), score()]), ok([{ ...score(), currentScore: null }]), ok([{ ...score(), maxScore: 0 }]),
    ok([{ ...score(), currentScore: 21 }])];
  for (const secureScores of cases) {
    assert.equal(evaluateSecurity({ ...resources(), secureScores }, now)[0].status, 'N/A');
    assert.equal(currentScore(secureScores, now).score, undefined);
  }
});

test('SEC-002 derives Default-state score gaps from current controls and profiles', () => {
  const finding = evaluateSecurity(resources(), now)[1];
  assert.equal(finding.status, 'WARN');
  assert.match(JSON.stringify(finding.evidence), /Example improvement/);
  assert.match(finding.why, /not verified Defender portal workflow/);
  assert.equal(finding.category, 'microsoft');
});

test('SEC-002 uses latest state chronologically and excludes completed, deprecated, reviewed, ignored or third-party controls', () => {
  for (const state of ['Ignored', 'Reviewed', 'ThirdParty']) {
    const p = profile();
    p.controlStateUpdates = [{ state, updatedDateTime: '2026-09-22T01:00:00Z' }, ...p.controlStateUpdates];
    assert.equal(evaluateSecurity({ ...resources(), controlProfiles: ok([p]) }, now)[1].status, 'PASS');
  }
  const p = profile();
  assert.equal(evaluateSecurity({ ...resources(), controlProfiles: ok([{ ...p, deprecated: true }]) }, now)[1].status, 'PASS');
  assert.equal(evaluateSecurity({ ...resources(), controlProfiles: ok([{ ...p, maxScore: 2 }]) }, now)[1].status, 'PASS');
});

test('SEC-002 unavailable or incomplete profiles, snapshot controls and state history return N/A', () => {
  for (const controlProfiles of [ok([]), unavailable(403), unavailable(404), ok([{ ...profile(), controlStateUpdates: [] }]),
    ok([{ ...profile(), controlStateUpdates: [{ state: 'unknown', updatedDateTime: '2026-09-21T00:00:00Z' }] }]),
    ok([{ ...profile(), id: 'unmatched' }]), ok([{ ...profile(), maxScore: null }]), ok([profile(), profile()])]) {
    assert.equal(evaluateSecurity({ ...resources(), controlProfiles }, now)[1].status, 'N/A');
  }
  for (const secureScores of [ok([]), ok([{ ...score(), controlScores: [] }]), ok([{ ...score(), controlScores: null }]),
    ok([{ ...score(), controlScores: [{ controlName: 'control-fixture', score: null }] }])]) {
    assert.equal(evaluateSecurity({ ...resources(), secureScores }, now)[1].status, 'N/A');
  }
});

test('DEF-001 distinguishes active/in-progress high incidents, other open incidents and resolved history', () => {
  for (const status of ['active', 'inProgress']) {
    assert.equal(evaluateSecurity({ ...resources(), incidents: ok([{ id: 'fixture', status, severity: 'high' }]) }, now)[2].status, 'FAIL');
  }
  assert.equal(evaluateSecurity({ ...resources(), incidents: ok([{ id: 'fixture', status: 'active', severity: 'medium' }]) }, now)[2].status, 'WARN');
  assert.equal(evaluateSecurity(resources(), now)[2].status, 'PASS');
});

test('DEF-001 empty or inaccessible Defender data does not invent incidents, zero counts or licensing diagnoses', () => {
  for (const incidents of [ok([]), unavailable(401), unavailable(403), unavailable(404), unavailable(429),
    ok([{ id: 'fixture', status: 'unknownFutureValue', severity: 'high' }]), ok([{ id: 'fixture', status: 'active', severity: null }])]) {
    const finding = evaluateSecurity({ ...resources(), incidents }, now)[2];
    assert.equal(finding.status, 'N/A');
    assert.equal(JSON.stringify(finding.evidence).includes('"highSeverityOpenCount":0'), false);
  }
});

test('APP-001 verifies exact delegated read-only local configuration, without claiming tenant grant audit', () => {
  assert.equal(evaluateScannerPermissions().status, 'PASS');
  assert.deepEqual([...scannerAccess.scopes].sort(), [...expectedScopes].sort());
  assert.equal(evaluateScannerPermissions({ permissionType: 'application', scopes: expectedScopes }).status, 'FAIL');
  assert.equal(evaluateScannerPermissions({ permissionType: 'delegated', scopes: ['User.Read'] }).status, 'FAIL');
  assert.equal(evaluateScannerPermissions({ permissionType: 'delegated', scopes: [...expectedScopes, 'Unexpected.Permission'] }).status, 'FAIL');
  assert.match(evaluateScannerPermissions().why, /does not audit/);
});

test('dashboard filters combine status/severity and summary excludes Microsoft readouts', () => {
  const findings = [...ca([policy()]), ...evaluateSecurity(resources(), now), evaluateScannerPermissions()];
  const summary = summarize(findings);
  assert.equal(summary.total, 5);
  assert.equal(Object.values(summary.counts).reduce((a, b) => a + b, 0), 5);
  assert.deepEqual(filterFindings(findings, 'FAIL', 'High').map(f => f.ruleId), ['CA-002']);
  assert.equal(filterFindings(findings, 'All', 'Info').length, 1);
  assert.equal(filterFindings(findings, 'WARN', 'Low').length, 0);
  assert.equal(filterFindings(findings, 'All', 'All').length, 5);
});

test('Graph paging rejects cycles and malformed nextLink', async () => {
  for (const next of ['https://graph.microsoft.com/v1.0/security/incidents', 123, '']) {
    const service = createGraphService(async () => 'test-token', async () => new Response(JSON.stringify({ value: [{ id: 'fixture' }], '@odata.nextLink': next })));
    const result = await service.collection('/security/incidents', 'SecurityIncident.Read.All');
    assert.equal(result.ok, false);
    assert.deepEqual(result.data, []);
  }
});

test('Graph partial provider data cannot produce a complete collection', async () => {
  const service = createGraphService(async () => 'test-token', async () => new Response(JSON.stringify({ value: [score()] }), { status: 206 }));
  const result = await service.collection('/security/secureScores', 'SecurityEvents.Read.All');
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 206);
  assert.deepEqual(result.data, []);
});

test('Graph pages policies and improvement profiles and recovers from throttling before continuing', async () => {
  for (const path of ['/identity/conditionalAccess/policies', '/security/secureScoreControlProfiles']) {
    let calls = 0;
    const waits: number[] = [];
    const service = createGraphService(async () => 'test-token', async (_url, init) => {
      assert.equal(init?.method, 'GET');
      calls++;
      if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
      return new Response(JSON.stringify(calls === 2 ? { value: [{ id: 'first' }], '@odata.nextLink': `https://graph.microsoft.com/v1.0${path}?page=2` } : { value: [{ id: 'second' }] }));
    }, async ms => { waits.push(ms); });
    const result = await service.collection(path, 'Policy.Read.All');
    assert.equal(result.data.length, 2);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1000]);
  }
});
