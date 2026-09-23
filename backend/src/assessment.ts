import { graphEndpoints, isRecord } from './graph.ts';
import type { GraphResult, GraphService } from './graph.ts';
import { evaluateConditionalAccess } from './conditionalAccess.ts';
import { evaluateSecurity, evaluateScannerPermissions } from './securityChecks.ts';

import type { Status, Finding, Assessment } from './contracts.ts';
export type { Status, Finding, Assessment } from './contracts.ts';
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
// Microsoft built-in role template ID, not a tenant/application identifier.
const globalAdminTemplate = '62e90394-69f5-4237-9190-012177145e10';

export async function assess(service: GraphService): Promise<Assessment> {
  const resources = {} as Assessment['resources'];
  await Promise.all(Object.entries(graphEndpoints).map(async ([key, endpoint]) => {
    resources[key as keyof typeof graphEndpoints] = await service.collection(endpoint.path, endpoint.scope);
  }));
  const role = resources.roles.data.find(item => item.roleTemplateId === globalAdminTemplate);
  const globalAdmins = resources.roles.ok && role && text(role.id)
    ? await service.collection(`/directoryRoles/${encodeURIComponent(role.id)}/members`, graphEndpoints.roles.scope)
    : { ...resources.roles, ok: false, data: [], message: resources.roles.message ?? 'Global Administrator role could not be resolved from the activated directory roles.' };
  return { resources, globalAdmins, findings: [
    ...evaluate(resources, globalAdmins),
    ...evaluateConditionalAccess(resources.policies, resources.roles),
    ...evaluateSecurity(resources),
    evaluateScannerPermissions(),
  ] };
}

export function evaluate(resources: Assessment['resources'], globalAdmins: GraphResult): Finding[] {
  const findings: Finding[] = [];
  const add = (result: GraphResult, ruleId: string, title: string, severity: Finding['severity'], valid: boolean,
    status: Status, why: string, evidence: unknown, recommendation: string) => {
    const checkable = result.ok && valid;
    findings.push({ ruleId, title, severity, status: checkable ? status : 'N/A',
      why: checkable ? why : `Not Checkable: ${result.message ?? 'Required data is empty, incomplete, or unavailable.'}`,
      evidence: checkable ? evidence : { reason: result.message ?? 'Missing required fields or records', httpStatus: result.httpStatus },
      recommendation, source: result.source, checkedAt: result.checkedAt });
  };
  const org = resources.organization.data[0];
  const domains = org?.verifiedDomains;
  add(resources.organization, 'ORG-001', 'Tenant metadata and verified domains', 'Info',
    resources.organization.data.length === 1 && text(org?.id) && text(org?.displayName) && Array.isArray(domains) && domains.length > 0 && domains.every(d => isRecord(d) && text(d.name)),
    'PASS', 'Tenant metadata and verified domain names are available. This checks inventory availability only.', org,
    'Review verified domains and confirm that each belongs to the organization.');

  const users = resources.users.data;
  const disabled = users.filter(user => user.accountEnabled === false);
  add(resources.users, 'USR-001', 'Disabled users', 'Low',
    users.length > 0 && users.every(user => text(user.id) && text(user.userPrincipalName) && typeof user.accountEnabled === 'boolean'),
    disabled.length ? 'WARN' : 'PASS', `${disabled.length} of ${users.length} users are disabled. Disabled accounts are a lifecycle review item, not proof of a vulnerability.`,
    { total: users.length, disabledCount: disabled.length, accounts: disabled.map(u => ({ id: u.id, userPrincipalName: u.userPrincipalName })) },
    'Review disabled accounts for retention and ownership. No changes are performed by this application.');
  const guests = users.filter(user => user.userType === 'Guest');
  add(resources.users, 'USR-002', 'Guest accounts', 'Medium',
    users.length > 0 && users.every(user => text(user.id) && text(user.userPrincipalName) && ['Guest', 'Member'].includes(String(user.userType))),
    guests.length ? 'WARN' : 'PASS', `${guests.length} of ${users.length} users are guests. Guest presence requires review, not automatic failure.`,
    { total: users.length, guestCount: guests.length, accounts: guests.map(u => ({ id: u.id, userPrincipalName: u.userPrincipalName })) },
    'Review guest sponsors, business need, and access periodically.');

  const roles = resources.roles.data;
  add(resources.roles, 'ROL-001', 'Privileged directory roles', 'High',
    roles.length > 0 && roles.every(role => text(role.id) && text(role.displayName) && text(role.roleTemplateId)),
    'WARN', 'Activated directory roles require privilege review. This conservative inventory includes all returned roles; it does not classify every role as highly privileged or cover PIM eligibility.',
    { activatedRoleCount: roles.length, roles }, 'Review assignments to activated directory roles using least privilege; assess PIM eligibility separately.');
  const members = globalAdmins.data;
  const validMembers = members.length > 0 && members.every(member => member['@odata.type'] === '#microsoft.graph.user' && text(member.id) && text(member.userPrincipalName));
  add(globalAdmins, 'ROL-002', 'Global Administrator accounts', 'High', validMembers,
    members.length > 4 ? 'FAIL' : 'WARN',
    `${members.length} direct Global Administrator user assignments. Assignment policy for this project: more than four fails; one to four requires manual review. Group-based membership and PIM eligibility are not assessed.`,
    { directUserCount: members.length, accounts: members.map(m => ({ id: m.id, displayName: m.displayName, userPrincipalName: m.userPrincipalName })) },
    'Review every Global Administrator assignment and emergency-access coverage. Groups, limited member data, or empty membership make this check N/A.');
  return findings;
}
