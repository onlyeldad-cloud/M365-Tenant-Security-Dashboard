import { isRecord } from './graph.ts';
import type { GraphRecord, GraphResult } from './graph.ts';
import type { Finding, Status } from './contracts.ts';

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
const populated = (value: unknown): boolean => value !== null && value !== undefined &&
  (Array.isArray(value) ? value.length > 0 : isRecord(value) ? Object.values(value).some(populated) : value !== '' && value !== false);
const list = (value: unknown): string[] => strings(value) ? value : [];
const globalAdminTemplate = '62e90394-69f5-4237-9190-012177145e10';
const states = ['enabled', 'disabled', 'enabledForReportingButNotEnforced'];

function exclusions(value: GraphRecord, path = 'conditions'): { path: string; value: unknown }[] {
  return Object.entries(value).flatMap(([key, item]) => {
    if ((key.startsWith('exclude') || (key === 'mode' && item === 'exclude')) && populated(item)) return [{ path: `${path}.${key}`, value: item }];
    return isRecord(item) ? exclusions(item, `${path}.${key}`) : [];
  });
}

function validConditions(policy: GraphRecord): boolean {
  const c = policy.conditions;
  if (!isRecord(c) || !isRecord(c.users) || !isRecord(c.applications) || !strings(c.clientAppTypes) || c.clientAppTypes.length === 0) return false;
  if (!c.clientAppTypes.every(client => ['all', 'browser', 'mobileAppsAndDesktopClients', 'exchangeActiveSync', 'easSupported', 'other'].includes(client))) return false;
  if (!['includeUsers', 'includeGroups', 'includeRoles', 'excludeUsers', 'excludeGroups', 'excludeRoles'].every(key => strings(c.users && (c.users as GraphRecord)[key]))) return false;
  if (!['includeApplications', 'excludeApplications'].every(key => strings((c.applications as GraphRecord)[key]))) return false;
  if (!strings(c.signInRiskLevels) || !strings(c.userRiskLevels)) return false;
  for (const key of ['locations', 'platforms']) {
    const obj = c[key];
    const suffix = key === 'locations' ? 'Locations' : 'Platforms';
    if (obj != null && (!isRecord(obj) || !strings(obj[`include${suffix}`]) || !strings(obj[`exclude${suffix}`]))) return false;
  }
  return true;
}

function validGrant(policy: GraphRecord): boolean {
  const grant = policy.grantControls;
  // A null grant with session controls is a valid policy that does not grant MFA/block access.
  if (grant === null) return true;
  return isRecord(grant) && ['AND', 'OR'].includes(String(grant.operator)) &&
    ['builtInControls', 'customAuthenticationFactors', 'termsOfUse'].every(key => strings(grant[key])) &&
    list(grant.builtInControls).every(control => ['block', 'mfa', 'compliantDevice', 'domainJoinedDevice', 'approvedApplication', 'compliantApplication', 'passwordChange', 'riskRemediation'].includes(control));
}

function mfaGrant(policy: GraphRecord): 'yes' | 'no' | 'unknown' {
  const grant = policy.grantControls;
  if (!isRecord(grant)) return 'no';
  const builtins = list(grant.builtInControls);
  if (builtins.includes('block')) return 'no';
  const strength = grant.authenticationStrength;
  const unknownStrength = strength != null && (!isRecord(strength) || !['mfa', 'none'].includes(String(strength.requirementsSatisfied)));
  const strengthMfa = isRecord(strength) && strength.requirementsSatisfied === 'mfa';
  const factors = [...builtins.map(control => control === 'mfa'),
    ...list(grant.customAuthenticationFactors).map(() => false), ...list(grant.termsOfUse).map(() => false),
    ...(strength != null ? [strengthMfa] : [])];
  if (!factors.length) return 'unknown';
  const required = grant.operator === 'AND' ? factors.some(Boolean) : factors.length > 0 && factors.every(Boolean);
  if (required) return 'yes';
  return unknownStrength ? 'unknown' : 'no';
}

/** Only prove broad coverage for explicitly understood, unrestricted conditions. */
function broad(policy: GraphRecord, clients: string[]): boolean {
  const c = policy.conditions as GraphRecord;
  const apps = c.applications as GraphRecord;
  if (!list(apps.includeApplications).includes('All') || exclusions(c).length) return false;
  if (Object.entries(apps).some(([key, value]) => !['includeApplications', 'excludeApplications', '@odata.type'].includes(key) && populated(value))) return false;
  if (!clients.every(client => list(c.clientAppTypes).includes('all') || list(c.clientAppTypes).includes(client))) return false;
  if (Object.entries(c).some(([key, value]) => !['users', 'applications', 'clientAppTypes', 'locations', 'platforms', '@odata.type'].includes(key) && populated(value))) return false;
  for (const [key, suffix] of [['locations', 'Locations'], ['platforms', 'Platforms']] as const) {
    const value = c[key];
    if (isRecord(value) && (!list(value[`include${suffix}`]).includes('All') ||
      Object.entries(value).some(([name, item]) => ![`include${suffix}`, `exclude${suffix}`, '@odata.type'].includes(name) && populated(item)))) return false;
  }
  const users = c.users as GraphRecord;
  return !Object.entries(users).some(([key, value]) => !['includeUsers', 'includeGroups', 'includeRoles', 'excludeUsers', 'excludeGroups', 'excludeRoles', '@odata.type'].includes(key) && populated(value));
}

export function evaluateConditionalAccess(result: GraphResult, roles: GraphResult): Finding[] {
  const findings: Finding[] = [];
  const active = result.data.filter(policy => policy.state === 'enabled');
  const configured = result.data.filter(policy => policy.state !== 'disabled');
  const headersValid = result.data.length > 0 && result.data.every(p => nonempty(p.id) && nonempty(p.displayName) && states.includes(String(p.state)));
  const conditionsValid = headersValid && configured.every(validConditions);
  const grantsValid = conditionsValid && configured.every(validGrant);
  function add(ruleId: string, title: string, valid: boolean, status: Status, why: string, evidence: unknown, recommendation: string, unavailableReason?: string) {
    findings.push({ ruleId, title, severity: 'High', status: result.ok && valid ? status : 'N/A',
      why: result.ok && valid ? why : `Not Checkable: ${result.message ?? unavailableReason ?? 'Policy inventory is empty or required policy fields are incomplete.'}`,
      evidence, recommendation, source: result.source, checkedAt: result.checkedAt });
  }

  const evaluable = active.filter(p => validConditions(p) && validGrant(p));
  const mfa = evaluable.filter(p => mfaGrant(p) === 'yes');
  const broadMfa = mfa.filter(p => broad(p, ['browser', 'mobileAppsAndDesktopClients']));
  const allUsersMfa = broadMfa.some(p => list(((p.conditions as GraphRecord).users as GraphRecord).includeUsers).includes('All'));
  const roleInventoryValid = roles.ok && roles.data.length > 0 && roles.data.every(role => nonempty(role.roleTemplateId));
  const requiredRoles = [...new Set([globalAdminTemplate, ...roles.data.map(role => String(role.roleTemplateId))])];
  const coveredRoles = new Set(broadMfa.flatMap(p => list(((p.conditions as GraphRecord).users as GraphRecord).includeRoles)));
  const rolesCovered = roleInventoryValid && requiredRoles.every(role => coveredRoles.has(role));
  const unknownMfa = active.some(p => mfaGrant(p) === 'unknown');
  const needsRoleInventory = !allUsersMfa && mfa.some(p => list(((p.conditions as GraphRecord)?.users as GraphRecord)?.includeRoles).length > 0);
  add('CA-001', 'Conditional Access MFA for administrators', grantsValid && !unknownMfa && (!needsRoleInventory || roleInventoryValid),
    allUsersMfa || rolesCovered ? 'PASS' : mfa.length ? 'WARN' : 'FAIL',
    allUsersMfa || rolesCovered
      ? 'Enabled policies require MFA for all users or all inventoried activated role templates plus Global Administrator, across all apps and modern clients without exclusions. This is configuration evidence, not a sign-in or PIM audit.'
      : mfa.length ? 'Enabled MFA controls exist, but administrator, application, client, or condition coverage is incomplete. Review the policy evidence.'
        : 'No enabled policy requires MFA. Disabled, report-only, and OR controls that allow non-MFA alternatives do not establish protection.',
    { policies: result.data, requiredRoleTemplates: requiredRoles, roleInventoryAvailable: roleInventoryValid, roleInventoryReason: roles.message, roleSource: roles.source, roleQueryTimestamp: roles.checkedAt, qualifyingPolicies: broadMfa.map(p => p.id), unknownAuthenticationStrength: unknownMfa },
    'Review enabled MFA coverage for administrative roles, all apps, and modern clients. Validate emergency-access exclusions and actual sign-ins separately.',
    unknownMfa ? 'Authentication strength or grant information cannot establish whether an MFA claim is required.'
      : needsRoleInventory && !roleInventoryValid ? roles.message ?? 'Role-targeted coverage requires a complete activated role inventory.' : undefined);

  const blockers = evaluable.filter(p => isRecord(p.grantControls) && list(p.grantControls.builtInControls).includes('block'));
  const legacy = ['exchangeActiveSync', 'other'];
  const blocked = legacy.filter(client => blockers.some(p => broad(p, [client]) && list(((p.conditions as GraphRecord).users as GraphRecord).includeUsers).includes('All')));
  add('CA-002', 'Legacy authentication blocked', grantsValid,
    blocked.length === legacy.length ? 'PASS' : blockers.length ? 'WARN' : 'FAIL',
    blocked.length === legacy.length ? 'Enabled block policies cover Exchange ActiveSync and other legacy clients for all users and apps without exclusions or additional restrictions.'
      : 'No complete enabled Conditional Access block for both legacy client categories was demonstrated. Other service-level protections are not evaluated.',
    { blockedClientTypes: blocked, policies: result.data }, 'Review enabled blocking of Exchange ActiveSync and other legacy authentication for all users and apps.');

  const excluded = configured.flatMap(p => isRecord(p.conditions) ? exclusions(p.conditions).map(item => ({ policyId: p.id, displayName: p.displayName, state: p.state, ...item })) : []);
  add('CA-003', 'Potentially uncontrolled Conditional Access exclusions', conditionsValid && configured.length > 0,
    excluded.length ? 'WARN' : 'PASS', excluded.length
      ? 'Enabled or report-only policies contain exclusions. Approval, ownership, compensating controls, and group membership cannot be established from this inventory.'
      : 'No explicit exclusions were found in the inspected enabled/report-only policy conditions. Narrow inclusion scopes still require separate coverage review.',
    { exclusions: excluded, inspectedPolicyIds: configured.map(p => p.id) }, 'Document each exclusion, its owner, justification, review date, and compensating controls. Do not remove emergency-access exclusions automatically.');
  return findings;
}
