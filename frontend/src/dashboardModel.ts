import type { Finding, Status } from '../../backend/src/contracts.ts';

export const statuses: Status[] = ['PASS', 'WARN', 'FAIL', 'N/A'];
export const severities: Finding['severity'][] = ['Info', 'Low', 'Medium', 'High'];
export function summarize(findings: Finding[]) {
  const scanner = findings.filter(finding => finding.category !== 'microsoft');
  return { total: scanner.length, counts: Object.fromEntries(statuses.map(status => [status, scanner.filter(f => f.status === status).length])) as Record<Status, number> };
}
export function filterFindings(findings: Finding[], status: Status | 'All', severity: Finding['severity'] | 'All') {
  return findings.filter(finding => finding.category !== 'microsoft' &&
    (status === 'All' || finding.status === status) && (severity === 'All' || finding.severity === severity));
}
