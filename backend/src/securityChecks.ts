import { expectedScopes, scannerAccess, isRecord } from './graph.ts';
import type { GraphRecord, GraphResult } from './graph.ts';
import type { Assessment, Finding, Status } from './contracts.ts';

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN;
// Explicit project freshness policy for daily snapshots; not a Microsoft SLA.
export const scoreMaxAgeMs = 72 * 60 * 60 * 1000;

export function currentScore(result: GraphResult, now = Date.now()): { score?: GraphRecord; reason?: string } {
  if (!result.ok) return { reason: result.message ?? 'Secure Score unavailable.' };
  if (!result.data.length) return { reason: 'Graph returned no Secure Score snapshots; no score can be inferred.' };
  if (!result.data.every(score => Number.isFinite(date(score.createdDateTime)))) return { reason: 'Snapshot dates are missing or invalid; the latest snapshot cannot be selected.' };
  const sorted = [...result.data].sort((a, b) => date(b.createdDateTime) - date(a.createdDateTime));
  const score = sorted[0]!; // Nonempty collection validated above.
  if (sorted[1] && date(score.createdDateTime) === date(sorted[1].createdDateTime)) return { reason: 'Multiple snapshots share the newest date; current score is ambiguous.' };
  const age = now - date(score.createdDateTime);
  if (age > scoreMaxAgeMs || age < -300000) return { reason: 'Latest snapshot is older than the project 72-hour freshness limit or has a future timestamp.' };
  if (!numeric(score.currentScore) || !numeric(score.maxScore) || score.currentScore < 0 || score.maxScore <= 0 || score.currentScore > score.maxScore) {
    return { reason: 'Current score or maximum score is missing or invalid.' };
  }
  return { score };
}

function finding(result: GraphResult, ruleId: string, title: string, severity: Finding['severity'], status: Status,
  why: string, evidence: unknown, recommendation: string, category: Finding['category'] = 'scanner'): Finding {
  return { ruleId, title, severity, status, why: status === 'N/A' ? `Not Checkable: ${why}` : why,
    evidence, recommendation, source: result.source, checkedAt: result.checkedAt, category };
}

export function evaluateSecurity(resources: Pick<Assessment['resources'], 'secureScores' | 'controlProfiles' | 'incidents'>, now = Date.now()): Finding[] {
  const { secureScores, controlProfiles, incidents } = resources;
  const { score, reason } = currentScore(secureScores, now);
  const scoreFinding = finding(secureScores, 'SEC-001', 'Current Microsoft Secure Score', 'Info', score ? 'PASS' : 'N/A',
    score ? `Microsoft Secure Score: ${score.currentScore} / ${score.maxScore}, snapshot ${score.createdDateTime}. PASS indicates data availability only, not a passing security score.` : reason!,
    score ? { currentScore: score.currentScore, maxScore: score.maxScore, snapshotAt: score.createdDateTime, freshnessLimitHours: 72 }
      : { reason, httpStatus: secureScores.httpStatus },
    'Review the Microsoft metric separately from scanner rules. Check licensing, access, and snapshot freshness when unavailable.', 'microsoft');

  const actions: GraphRecord[] = [];
  const excluded: GraphRecord[] = [];
  const missing: string[] = [];
  let actionReason = reason;
  if (!controlProfiles.ok) actionReason = controlProfiles.message ?? 'Control profile endpoint unavailable.';
  else if (!controlProfiles.data.length) actionReason = 'No Secure Score control profiles were returned.';
  else if (!score || !Array.isArray(score.controlScores) || !score.controlScores.length) actionReason ??= 'Snapshot control scores are unavailable or empty.';
  else {
    const controls = score.controlScores;
    const seen = new Set<string>();
    for (const entry of controls) {
      if (!isRecord(entry) || !text(entry.controlName) || !numeric(entry.score) || entry.score < 0 || seen.has(entry.controlName)) {
        missing.push('Invalid or duplicate snapshot control'); continue;
      }
      seen.add(entry.controlName);
      const matches = controlProfiles.data.filter(profile => profile.id === entry.controlName);
      const profile = matches.length === 1 ? matches[0] : undefined;
      if (!profile || typeof profile.deprecated !== 'boolean') { missing.push(entry.controlName); continue; }
      if (profile.deprecated) { excluded.push({ id: profile.id, reason: 'Deprecated' }); continue; }
      if (!numeric(profile.maxScore) || profile.maxScore <= 0 || entry.score > profile.maxScore || !text(profile.title) || !text(profile.remediation)) {
        missing.push(entry.controlName); continue;
      }
      if (entry.score === profile.maxScore) { excluded.push({ id: profile.id, reason: 'Full score in current snapshot' }); continue; }
      const updates = profile.controlStateUpdates;
      if (!Array.isArray(updates) || !updates.length || !updates.every(update => isRecord(update) &&
        text(update.state) && ['default', 'ignored', 'thirdparty', 'reviewed'].includes(update.state.toLowerCase()) && Number.isFinite(date(update.updatedDateTime)))) {
        missing.push(entry.controlName); continue;
      }
      const ordered = [...updates].sort((a, b) => date(b.updatedDateTime) - date(a.updatedDateTime));
      if (date(ordered[0].updatedDateTime) > now + 300000 || (ordered.length > 1 && date(ordered[0].updatedDateTime) === date(ordered[1].updatedDateTime) && ordered[0].state !== ordered[1].state)) {
        missing.push(entry.controlName); continue;
      }
      const state = ordered[0].state.toLowerCase();
      if (state !== 'default') { excluded.push({ id: profile.id, reason: `Recorded state: ${ordered[0].state}` }); continue; }
      actions.push({ id: profile.id, title: profile.title, score: entry.score, maxScore: profile.maxScore,
        recordedState: ordered[0].state, stateUpdatedAt: ordered[0].updatedDateTime, remediation: profile.remediation });
    }
    if (missing.length) actionReason = 'Some current controls lack usable profiles, scores, or state history; a complete action list cannot be established.';
  }
  const actionsFinding = finding({ ...controlProfiles, source: `${secureScores.source} ; ${controlProfiles.source}` },
    'SEC-002', 'Current Secure Score improvement actions', 'Info', actionReason ? 'N/A' : actions.length ? 'WARN' : 'PASS',
    actionReason ?? (actions.length ? `${actions.length} current controls have score gaps and a recorded Default state. These are derived improvement candidates, not verified Defender portal workflow items.`
      : 'All matched current controls are fully scored, deprecated, or have a recorded non-Default state. No Default-state score gaps were found; this is not a security-compliance verdict.'),
    { snapshotAt: score?.createdDateTime, scoreQueriedAt: secureScores.checkedAt, profilesQueriedAt: controlProfiles.checkedAt,
      actions, excluded, missing, reason: actionReason, httpStatus: controlProfiles.httpStatus },
    'Review the listed remediation in Microsoft Secure Score. Portal workflow and applicability can differ; unavailable state/profile data cannot establish open actions.', 'microsoft');

  const validIncidents = incidents.ok && incidents.data.length > 0 && incidents.data.every(incident => text(incident.id) &&
    ['active', 'inProgress', 'resolved', 'redirected'].includes(String(incident.status)) &&
    ['informational', 'low', 'medium', 'high'].includes(String(incident.severity)));
  const open = incidents.data.filter(incident => ['active', 'inProgress'].includes(String(incident.status)));
  const high = open.filter(incident => incident.severity === 'high');
  const incidentFinding = finding(incidents, 'DEF-001', 'Open high-severity Defender incidents', 'High',
    !validIncidents ? 'N/A' : high.length ? 'FAIL' : open.length ? 'WARN' : 'PASS',
    !validIncidents ? incidents.message ?? (incidents.data.length ? 'Incident severity/status fields are missing or unknown.'
      : 'Graph returned no incidents. This does not establish licensing, visibility, or the absence of threats.')
      : high.length ? `${high.length} high-severity incidents are active or in progress.`
        : open.length ? 'Open incidents exist, but none of the returned incidents are high severity.'
          : 'No open incidents were found in the complete, nonempty returned inventory within Defender retention and caller visibility.',
    { total: incidents.data.length, openCount: validIncidents ? open.length : undefined, highSeverityOpenCount: validIncidents ? high.length : undefined,
      openHighSeverityIncidents: validIncidents ? high : [], httpStatus: incidents.httpStatus, reason: incidents.message },
    'Investigate open incidents in Defender. If unavailable, verify delegated consent, the signed-in security role, and Defender licensing; this scanner does not resolve incidents.');
  return [scoreFinding, actionsFinding, incidentFinding];
}

export function evaluateScannerPermissions(access: { permissionType: string; scopes: readonly string[] } = scannerAccess): Finding {
  const missing = expectedScopes.filter(scope => !access.scopes.includes(scope));
  const unexpected = access.scopes.filter(scope => !(expectedScopes as readonly string[]).includes(scope));
  const valid = access.permissionType === 'delegated' && !missing.length && !unexpected.length;
  return {
    ruleId: 'APP-001', title: 'Scanner Graph permission configuration', severity: 'Info', status: valid ? 'PASS' : 'FAIL',
    why: valid ? 'The scanner requests exactly the six expected delegated read-only Graph scopes. This local configuration check does not audit the Entra registration, tenant consent, or additional grants.'
      : 'The scanner permission configuration differs from the expected delegated read-only scope list.',
    evidence: { expected: expectedScopes, configured: access, missing, unexpected, registrationAudit: 'Not Checkable with the current scanner scope' },
    recommendation: 'Confirm these six permissions are Delegated in the existing Entra registration and grant admin consent. Review any additional registration permissions manually; do not add application or write permissions.',
    source: 'Local scannerAccess configuration in backend/src/graph.ts', checkedAt: new Date().toISOString(), category: 'scanner',
  };
}
