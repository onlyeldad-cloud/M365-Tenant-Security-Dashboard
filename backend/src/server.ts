import dotenv from 'dotenv';
import { createApp } from './app.ts';
import { createTokenValidator } from './auth.ts';
import { loadConfig } from './config.ts';
import { createConfidentialClient, createOboProvider } from './obo.ts';

dotenv.config({ quiet: true });
try {
  const config = loadConfig();
  const client = createConfidentialClient(config);
  const app = createApp({ validate: createTokenValidator(config),
    tokenProvider: (caller, observe) => createOboProvider(client, caller.assertion, observe) });
  app.listen(config.port, 'localhost', () => { console.log('Assessment API listening on the configured localhost port.'); });
} catch {
  console.error('API startup failed. Check backend environment settings and certificate files; see ENTRA_SETUP.md.');
  process.exitCode = 1;
}
