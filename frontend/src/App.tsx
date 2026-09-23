import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
  useMsal,
} from "@azure/msal-react";

import { loginRequest } from "./authConfig";
import Dashboard from "./Dashboard";
import { useState } from "react";

import { useLanguage, useDocumentLanguage } from './i18n/useLanguage.ts';
import { LanguageSelector } from './i18n/LanguageSelector.ts';

function App() {
  const { t, message } = useLanguage();
  useDocumentLanguage();
  const { instance, accounts } = useMsal();
  const [authError, setAuthError] = useState("");
  const [logoAvailable, setLogoAvailable] = useState(true);

  const handleLogin = async () => {
    try {
      setAuthError("");
      await instance.loginPopup(loginRequest);
    } catch {
      setAuthError("Sign-in was not completed. Please try again.");
    }
  };

  const handleLogout = async () => {
    try {
      await instance.logoutPopup();
    } catch {
      setAuthError("Sign-out was not completed. Please try again.");
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label={t("KRN security workspace")}>
          {logoAvailable ? <img className="brand-logo" src="/krn-logo.png" alt="KRN" onError={() => setLogoAvailable(false)} /> : <span className="brand-wordmark">KR<span>N</span></span>}
          <span className="brand-subtitle">{t('MICROSOFT 365 SECURITY')}</span>
        </a>
        <p className="nav-label">{t('WORKSPACE')}</p>
        <nav aria-label={t("Dashboard sections")}><a href="#overview">{t('Overview')} <span>↗</span></a><a href="#findings">{t('Security findings')}</a><a href="#microsoft">Microsoft Secure Score</a><a href="#sources">{t('Data sources')}</a></nav>
        <div className="sidebar-note"><span className="read-only-dot" />{t('Read-only by design')}<p>{t('Visibility into your tenant.')}<br />{t('Your configuration stays yours.')}</p></div>
      </aside>
      <main className="main-content" id="overview">
        <header className="topbar"><span>{t('Workspace')} <span className="divider">/</span> {t('Tenant security')}</span><span className="tag">{t('Read-only assessment')}</span><LanguageSelector /></header>
        <div className="page-content">
      <div className="page-heading"><div><p className="eyebrow">MICROSOFT 365</p><h1>{t('Tenant security')}</h1></div><AuthenticatedTemplate><div className="account"><span className="avatar" aria-hidden="true">{accounts[0]?.name?.slice(0, 1) || 'M'}</span><span>{accounts[0]?.username}</span><button onClick={handleLogout}>{t('Sign out')}</button></div></AuthenticatedTemplate></div>
      {authError && <p className="notice error" role="alert">{message(authError)}</p>}

      <UnauthenticatedTemplate>
        <section className="welcome"><div className="welcome-copy"><span className="tag">{t('Clarity before action')}</span><h2>{t('Know where your tenant stands.')}</h2><p>{t('Bring identity, access policies, and security signals into one focused view. Find what needs attention with evidence you can review.')}</p><button className="primary" onClick={handleLogin}>{t('Sign in with Microsoft')} <span aria-hidden="true">→</span></button><p className="muted small">{t('Use your organization’s Microsoft account.')}</p></div><div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="shield">◈</div><span className="art-caption">{t('VISIBILITY. CONFIDENCE. CONTROL.')}</span></div></section>
        <div className="feature-grid"><article><span>{t('01 / IDENTITY')}</span><h3>{t('Understand access')}</h3><p>{t('Review users, guests, and privileged directory roles.')}</p></article><article><span>{t('02 / POLICIES')}</span><h3>{t('Find protection gaps')}</h3><p>{t('Inspect MFA coverage, legacy authentication, and exclusions.')}</p></article><article><span>{t('03 / SECURITY')}</span><h3>{t('Focus your response')}</h3><p>{t('Review Defender incidents and separate Microsoft score insights.')}</p></article></div>
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <Dashboard key={accounts[0]?.homeAccountId} />
      </AuthenticatedTemplate>
      <footer>{t('Microsoft 365 Tenant Security Dashboard')} <span>{t('Evidence-led. Read-only.')}</span></footer>
      </div></main>
    </div>
  );
}

export default App;
