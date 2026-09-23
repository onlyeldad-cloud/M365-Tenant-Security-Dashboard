export const apiScopeName = 'Assessment.Read';
export type ApiConfig = { tenantId: string; clientId: string; spaClientId: string };
export type ServerConfig = ApiConfig & { certificatePath: string; privateKeyPath: string; port: number };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required setting: ${name}`);
    return value;
  };
  const id = (name: string) => {
    const value = required(name);
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) throw new Error(`Invalid identifier setting: ${name}`);
    return value.toLowerCase();
  };
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT setting');
  return { tenantId: id('ENTRA_TENANT_ID'), clientId: id('ENTRA_API_CLIENT_ID'), spaClientId: id('ENTRA_SPA_CLIENT_ID'),
    certificatePath: required('ENTRA_CERTIFICATE_PATH'), privateKeyPath: required('ENTRA_PRIVATE_KEY_PATH'), port };
}
