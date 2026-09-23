// Type-only response contract. No credentials, transport, or rule implementation.
export type Status = 'PASS' | 'WARN' | 'FAIL' | 'N/A';
export type Finding = {
  ruleId: string; title: string; severity: 'Info' | 'Low' | 'Medium' | 'High'; status: Status;
  why: string; evidence: unknown; recommendation: string; source: string; checkedAt: string;
  category?: 'scanner' | 'microsoft' | undefined;
};
export type GraphRecord = Record<string, unknown>;
export type GraphResult = {
  ok: boolean; data: GraphRecord[]; source: string; checkedAt: string;
  message?: string | undefined; httpStatus?: number | undefined; retryAfterSeconds?: number | undefined;
};
export type ResourceName = 'organization' | 'users' | 'roles' | 'policies' | 'secureScores' | 'controlProfiles' | 'incidents';
export type Assessment = { resources: Record<ResourceName, GraphResult>; globalAdmins: GraphResult; findings: Finding[] };
