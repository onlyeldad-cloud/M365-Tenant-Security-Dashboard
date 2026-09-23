import { useLanguage } from './i18n/useLanguage.ts';
import { translate, translateMessage } from './i18n/i18n.ts';
import type { Language } from './i18n/i18n.ts';
import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import type { Assessment, Finding, Status, GraphResult } from '../../backend/src/contracts.ts';
import { requestAssessment, AssessmentApiError } from './api.ts';
import { apiScope } from './authConfig.ts';
import { filterFindings, severities, statuses, summarize } from './dashboardModel.ts';

function availability(result: GraphResult, language: Language) {
  if (!result.ok) return translate(language, 'Not Checkable: ') + translateMessage(language, result.message ?? 'Required data is empty, incomplete, or unavailable.');
  return result.data.length ? translate(language, '{count} record(s) retrieved', { count: result.data.length }) : translate(language, 'N/A / Not Checkable: no records returned');
}

export function FindingView({ finding }: { finding: Finding }) {
  const { t, message } = useLanguage();
  return <article className="finding">
    <div className="finding-heading"><div><span className="rule-id">{finding.ruleId}</span><h3>{message(finding.title)}</h3></div><span className={`badge status-${finding.status.replace('/', '').toLowerCase()}`}>{t(finding.status)}</span></div>
    <p className="severity">{t("Severity")}: {t(finding.severity)}</p>
    <p>{message(finding.why)}</p>
    <details>
      <summary>{t("View details for {id}", { id: finding.ruleId })}</summary>
      <p>{t("Recommendation")}: {message(finding.recommendation)}</p>
      <h4>{t("Evidence")}</h4>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(finding.evidence, null, 2)}</pre>
      <p style={{ overflowWrap: 'anywhere' }}>{t("Source")}: {message(finding.source)}</p>
      <p>{t("Query/check timestamp")}: <time dateTime={finding.checkedAt}>{finding.checkedAt}</time></p>
    </details>
  </article>;
}

export default function Dashboard() {
  const { t, message: localizeMessage, language } = useLanguage();
  const { instance, accounts, inProgress } = useMsal();
  const account = accounts[0];
  const [assessment, setAssessment] = useState<Assessment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Run the assessment to retrieve current tenant data.');
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All');
  const [severityFilter, setSeverityFilter] = useState<Finding['severity'] | 'All'>('All');
  const active = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function run() {
    if (!account || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setAssessment(undefined);
    setMessage('Assessing your tenant. Some checks may take longer to complete.');
    try {
      if (!apiScope) throw new AssessmentApiError('API scope is not configured. Complete the setup in ENTRA_SETUP.md.');
      const scope = apiScope;
      const result = await requestAssessment(async forceRefresh => {
        const response = await instance.acquireTokenSilent({ account, scopes: [scope], forceRefresh });
        return response.accessToken;
      });
      if (active.current) {
        setAssessment(result);
        setMessage('Assessment complete. N/A means the check could not be evaluated.');
      }
    } catch (error) {
      if (active.current) {
        setError(error instanceof AssessmentApiError ? error.message : 'Assessment unavailable. Please try again.');
        setMessage('Assessment did not complete.');
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function authorize() {
    if (!account || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('Waiting for read-access authorization.');
    try {
      if (!apiScope) throw new Error('API scope is not configured');
      await instance.acquireTokenPopup({ account, scopes: [apiScope] });
      if (active.current) setMessage('Read access authorized. Run the assessment to load data.');
    } catch {
      if (active.current) {
        setError('API access was not authorized. Check the API scope configuration and administrator consent.');
        setMessage('Authorization did not complete.');
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }

  const findings = assessment?.findings ?? [];
  const summary = summarize(findings);
  const visible = filterFindings(findings, statusFilter, severityFilter);
  const microsoft = findings.filter(finding => finding.category === 'microsoft');
  const org = assessment?.resources.organization;
  const tenantName = org?.ok && typeof org.data[0]?.displayName === 'string' ? org.data[0].displayName : t('N/A');
  const disabled = busy || inProgress !== InteractionStatus.None;
  const failedSources = assessment ? Object.entries({ ...assessment.resources, globalAdmins: assessment.globalAdmins }).filter(([, result]) => !result.ok) : [];

  return <section className="dashboard" aria-busy={busy}>
    <div className="overview"><div><p className="eyebrow">{t('TENANT OVERVIEW')}</p><h2>{assessment ? tenantName : t('Your security, in focus.')}</h2><p className="muted">{t('A read-only view of identity, access policies, and security signals.')}</p></div>
    <div className="actions"><button className="primary" disabled={disabled} onClick={run}>{t(busy ? 'Working…' : assessment ? 'Refresh assessment' : 'Run assessment')}</button>
      <button disabled={disabled} onClick={authorize}>{t('Authorize access')}</button></div></div>
    <p className="scan-status" role="status" aria-live="polite"><span className={busy ? 'activity busy' : 'activity'} />{localizeMessage(message)}</p>
    {busy && <progress aria-label={t("Assessment or authorization in progress")} />}
    {error && <p className="notice error" role="alert">{localizeMessage(error)}</p>}
    {failedSources.length > 0 && <div className="notice" role="alert">
      <p>{t('Some sources could not be checked. Their dependent findings are N/A.')}</p>
      <ul>{failedSources.map(([name, result]) => <li key={name}>{t(name)}: {localizeMessage(result.message ?? "Required data is empty, incomplete, or unavailable.")}</li>)}</ul>
    </div>}
    <div className="section-heading"><h2>{t('Assessment at a glance')}</h2><span className="muted">{assessment ? t('{total} checks · {count} separate Microsoft readouts', { total: summary.total, count: microsoft.length }) : t('Awaiting your first assessment')}</span></div>
    <div className="summary-grid" aria-label={t("Scanner status summary")}>
      {statuses.map(status => <div key={status} className={`summary-card status-${status.replace('/', '').toLowerCase()}`}>
        <span className="summary-label">{t(status)}</span><strong className="summary-number">{assessment ? summary.counts[status] : '—'}</strong><span className="summary-caption">{t(status === 'PASS' ? 'Checks satisfied' : status === 'WARN' ? 'Review recommended' : status === 'FAIL' ? 'Attention required' : 'Not checkable')}</span>
      </div>)}
    </div>
    {assessment && <>
      <div className="section-heading" id="findings"><h2>{t('Security findings')}</h2><span className="muted">{t("{count} of {total} checks", { count: visible.length, total: summary.total })}</span></div>
      <p className="muted">{t('Filter your findings to focus on what needs attention. Summary counts stay unchanged.')}</p>
      <div className="filters">
        <label>{t("Status")} <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as Status | 'All')}>
          <option value="All">{t('All statuses')}</option>{statuses.map(status => <option key={status} value={status}>{t(status)}</option>)}
        </select></label>{' '}
        <label>{t("Severity")} <select value={severityFilter} onChange={event => setSeverityFilter(event.target.value as Finding['severity'] | 'All')}>
          <option value="All">{t('All severities')}</option>{severities.map(severity => <option key={severity} value={severity}>{t(severity)}</option>)}
        </select></label>{' '}
        <button onClick={() => { setStatusFilter('All'); setSeverityFilter('All'); }}>{t('Clear filters')}</button>
      </div>
      {visible.length === 0 && <p className="empty-state">{t('No findings match these filters.')}</p>}
      <div className="findings-grid">{visible.map(finding => <FindingView key={finding.ruleId} finding={finding} />)}</div>
      <div className="section-heading" id="microsoft"><h2>Microsoft Secure Score</h2><span className="tag">{t('Separate Microsoft metric')}</span></div>
      <p className="muted">{t('PASS here indicates available data or no Default-state score gaps. These readouts do not affect scanner totals.')}</p>
      <div className="findings-grid">{microsoft.map(finding => <FindingView key={finding.ruleId} finding={finding} />)}</div>
      <div className="section-heading" id="sources"><h2>{t('Data sources')}</h2><span className="muted">{t('Evidence and availability')}</span></div>
      <p className="muted">{t('Unavailable data is never treated as a pass. Permission, role, or license restrictions may require administrator review.')}</p>
      {Object.entries(assessment.resources).map(([name, result]) => <details className="source-row" key={name}>
        <summary>{t(name)}: {availability(result, language)}</summary>
        <p style={{ overflowWrap: 'anywhere' }}>{t("Source")}: {result.source} | {t("Query timestamp")}: {result.checkedAt}</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result.data, null, 2)}</pre>
      </details>)}
    </>}
    {!assessment && !busy && <div className="empty-state"><span className="empty-icon" aria-hidden="true">◈</span><h3>{t('Start with a clear picture')}</h3><p>{t('Run an assessment to review your tenant’s identity and security posture.')}<br />{t('Your settings stay unchanged.')}</p></div>}
  </section>;
}
