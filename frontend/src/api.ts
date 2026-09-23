import type { Assessment } from '../../backend/src/contracts.ts';

export class AssessmentApiError extends Error {}

export async function requestAssessment(getToken: (refresh: boolean) => Promise<string>, fetcher: typeof fetch = fetch): Promise<Assessment> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken(attempt > 0);
      const response = await fetcher('/api/assessment', {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(300000),
      });
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) {
        const message = response.status === 401 ? 'Your API session could not be validated. Authorize access or sign in again.'
          : response.status === 403 ? 'Assessment access was denied. Check the API scope and administrator consent.'
          : response.status === 429 ? 'The assessment API is busy. Wait before trying again.'
          : 'The assessment API is unavailable. Check that the backend is running and configured.';
        throw new AssessmentApiError(message);
      }
      const body = await response.json() as Assessment;
      if (!body || !Array.isArray(body.findings) || !body.resources || !body.globalAdmins ||
        !body.findings.every(f => f && typeof f.ruleId === 'string' && ['PASS', 'WARN', 'FAIL', 'N/A'].includes(f.status))) {
        throw new AssessmentApiError('The assessment API returned an invalid response.');
      }
      return body;
    }
    throw new AssessmentApiError('Your API session could not be validated.');
  } catch (error) {
    if (error instanceof AssessmentApiError) throw error;
    throw new AssessmentApiError('Assessment unavailable. Authorize API access and check the backend connection.');
  }
}
