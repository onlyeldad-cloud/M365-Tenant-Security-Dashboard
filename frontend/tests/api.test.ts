import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestAssessment } from '../src/api.ts';
import { filterFindings, summarize } from '../src/dashboardModel.ts';
import type { Finding } from '../../backend/src/contracts.ts';

test('frontend sends only an API bearer token to the local assessment endpoint', async () => {
  const response = { resources: {}, globalAdmins: {}, findings: [] };
  const result = await requestAssessment(async () => 'synthetic-api-token', async (url, init) => {
    assert.equal(url, '/api/assessment');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-api-token');
    return new Response(JSON.stringify(response));
  });
  assert.deepEqual(result, response);
});

test('API 401 refreshes once without unbounded retry', async () => {
  const refreshes: boolean[] = [];
  let calls = 0;
  await assert.rejects(requestAssessment(async refresh => { refreshes.push(refresh); return 'fixture'; }, async () => { calls++; return new Response('', { status: 401 }); }), /session could not be validated/);
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(calls, 2);
});

test('API failures and token failures do not expose raw upstream messages', async () => {
  for (const status of [403, 429, 500, 502]) {
    await assert.rejects(requestAssessment(async () => 'fixture', async () => new Response('sensitive token', { status })), error => {
      assert.equal((error as Error).message.includes('sensitive token'), false); return true;
    });
  }
  await assert.rejects(requestAssessment(async () => { throw new Error('sensitive token'); }), /Authorize API access/);
  await assert.rejects(requestAssessment(async () => 'fixture', async () => new Response('{}')), /invalid response/);
});

test('filters and summary preserve status, severity and separate Microsoft readouts', () => {
  const finding = { ruleId: 'fixture', title: 'Fixture', severity: 'High', status: 'FAIL', why: '', evidence: {}, recommendation: '', source: '', checkedAt: '' } as Finding;
  const findings: Finding[] = [finding, { ...finding, status: 'PASS', severity: 'Low' }, { ...finding, category: 'microsoft' }];
  assert.equal(summarize(findings).total, 2);
  assert.equal(summarize(findings).counts.FAIL, 1);
  assert.equal(filterFindings(findings, 'FAIL', 'High').length, 1);
  assert.equal(filterFindings(findings, 'PASS', 'High').length, 0);
});
