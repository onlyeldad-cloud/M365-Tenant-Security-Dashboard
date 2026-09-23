# Berechtigungsmatrix

Das Dashboard unterst?tzt **Deutsch / English**; Deutsch ist voreingestellt. Der Sprachwechsel ist rein lokal und ben?tigt keine Berechtigung. Technische Scope-Namen bleiben in beiden Sprachen unver?ndert.

SPA und Backend sind separate Single-Tenant-Registrierungen. Alle folgenden Ressourcenberechtigungen sind **delegiert und nur lesend**. Ein Zertifikat authentifiziert das Backend innerhalb des On-Behalf-Of (OBO)-Ablaufs; es aktiviert keine Graph-Anwendungsberechtigungen.

## SPA: ausschlie?lich Zugriff auf die eigene API

| Ressource | Berechtigung | Zweck |
| --- | --- | --- |
| Backend-API dieses Projekts | `Assessment.Read` | Zugriff auf GET `/api/assessment` mit der Backend-API als Token-Zielgruppe; Voraussetzung f?r alle Pr?fungen. |

Die SPA hat **keine direkten Microsoft Graph-Berechtigungen**. `openid` und `profile` sind Anmeldeprotokoll-Scopes; von MSAL verwaltete Protokoll-Scopes ?ndern diese Ressourcentrennung nicht.

Der Projektverantwortliche best?tigte am 2026-09-23: Alle sechs fr?heren Graph-Berechtigungen wurden aus der SPA entfernt und ihre alten Einwilligungen in der Enterprise Application widerrufen. Anschlie?ende saubere Ab-/Anmeldung und Bewertung waren erfolgreich. Dies ist ein Live-Bericht, keine automatisierte Pr?fung tats?chlicher Grants.

## Backend: delegierte Microsoft Graph-Leseberechtigungen

| Berechtigung | GET-Daten | Zweck und abh?ngige Pr?fungen |
| --- | --- | --- |
| `User.Read` | `/organization?$select=id,displayName,verifiedDomains` | Begrenzte Tenant-Metadaten: ORG-001 und Tenant-Name. |
| `User.Read.All` | `/users?$select=id,displayName,userPrincipalName,userType,accountEnabled` | Benutzerbestand, Gasttyp und Aktivierungsstatus: USR-001/002; unterst?tzt vollst?ndige Benutzerdetails f?r ROL-002. |
| `RoleManagement.Read.Directory` | `/directoryRoles`, `/directoryRoles/{resolved-role-id}/members` | Aktivierte Rollen und direkte globale Administratormitglieder: ROL-001/002; rollenbezogene Abdeckung in CA-001. |
| `Policy.Read.All` | `/identity/conditionalAccess/policies` | Richtlinienzustand, Bedingungen, Zugriffsgew?hrung und Ausnahmen: CA-001/002/003. |
| `SecurityEvents.Read.All` | `/security/secureScores`, `/security/secureScoreControlProfiles` | Score-Momentaufnahmen und Kontrollprofile: SEC-001/002, separat von Scanner-Gesamtzahlen. |
| `SecurityIncident.Read.All` | `/security/incidents?$top=10` und Folgeseiten | Vorfallstatus und Schweregrad: DEF-001, offene Vorf?lle mit hohem Schweregrad. |

APP-001 pr?ft ausschlie?lich die lokale Scope-Konfiguration in [backend/src/graph.ts](backend/src/graph.ts), keine tats?chlichen Registrierungsberechtigungen oder Einwilligungen. Daf?r ist kein weiterer Endpunkt n?tig. CA-001 ben?tigt bei Abdeckung aller Benutzer keinen Rollenbestand, bei rollenbezogener Abdeckung dagegen schon.

Alle Sammlungen folgen sicheren `@odata.nextLink`-Verweisen. `$top=10` begrenzt die Seitengr??e, nicht den vollst?ndigen Vorfallbestand. Der Transport implementiert ausschlie?lich GET; die OBO-Scope-Liste ist eingeschr?nkt.

## Einwilligung, Rollen und Lizenzen

Bei einer neuen Installation ist Administratoreinwilligung f?r **beide** Verbindungen erforderlich: SPA ? Backend und Backend ? Graph. Die validierte Installation ben?tigt f?r die Lokalisierung keine ?nderungen.

Delegierter Zugriff bleibt durch Benutzerrolle und Dienstverf?gbarkeit begrenzt. Der gemeldete Defender HTTP 403 ergibt korrekt `N/A` beziehungsweise **NICHT PR?FBAR**. Die genaue Ursache bez?glich Berechtigung, Rolle oder Lizenz ist nicht nachgewiesen; das Ergebnis sagt nichts ?ber die Abwesenheit von Vorf?llen aus.

Keine direkten SPA-Graph-Berechtigungen wiederherstellen und keine Anwendungs- oder ReadWrite-Berechtigungen erg?nzen. Zertifikate und private Schl?ssel bleiben au?erhalb der SPA. Einrichtung: [ENTRA_SETUP.md](ENTRA_SETUP.md).

**English note:** The SPA uses only delegated `Assessment.Read`. The backend uses the six delegated read-only Graph scopes above. Language selection changes presentation only; permission names, evidence and internal statuses are preserved.

## Microsoft-API-Referenzen

- [Organization properties available with User.Read](https://learn.microsoft.com/en-us/graph/api/organization-list?view=graph-rest-1.0)
- [User listing](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)
- [Directory role members and limited-information behavior](https://learn.microsoft.com/en-us/graph/api/directoryrole-list-members?view=graph-rest-1.0)
- [Conditional Access policies](https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-list-policies?view=graph-rest-1.0)
- [Secure Score control profiles](https://learn.microsoft.com/en-us/graph/api/security-list-securescorecontrolprofiles?view=graph-rest-1.0)
- [Defender incidents](https://learn.microsoft.com/en-us/graph/api/security-list-incidents?view=graph-rest-1.0)
