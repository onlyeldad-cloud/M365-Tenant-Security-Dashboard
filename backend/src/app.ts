import express from 'express';
import cors from 'cors';
import type { ErrorRequestHandler } from 'express';
import { authenticate } from './auth.ts';
import type { Caller, createTokenValidator } from './auth.ts';
import { assess } from './assessment.ts';
import { createGraphService } from './graph.ts';
import type { TokenProvider } from './graph.ts';

type Dependencies = {
  validate: ReturnType<typeof createTokenValidator>;
  tokenProvider: (caller: Caller, observeToken: (token: string) => void) => TokenProvider;
  graphFetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
};

// A final boundary defense: credentials cannot escape even in an unexpected provider payload.
export function safeResponse(value: unknown, tokens: string[]): unknown {
  if (typeof value === 'string') return tokens.reduce((result, token) => token ? result.replaceAll(token, '[REDACTED]') : result, value);
  if (Array.isArray(value)) return value.map(item => safeResponse(item, tokens));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(access_?token|refresh_?token|id_?token|authorization|client_?secret|private_?key|oboAssertion)$/i.test(key))
    .map(([key, item]) => [key, safeResponse(item, tokens)]));
  return value;
}

export function createApp(deps: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin && origin !== 'http://localhost:5173') {
      res.status(403).json({ error: 'origin_not_allowed', message: 'This origin is not allowed.' });
      return;
    }
    next();
  });
  app.use(cors({ origin: 'http://localhost:5173', methods: ['GET'], allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  app.get('/api/health', (_req, res) => { res.json({ status: 'healthy' }); });
  app.get('/api/assessment', authenticate(deps.validate), async (_req, res) => {
    const caller = res.locals.caller as Caller;
    const tokens = [caller.assertion];
    try {
      const provider = deps.tokenProvider(caller, token => { tokens.push(token); });
      const result = await assess(createGraphService(provider, deps.graphFetch, deps.wait));
      res.json(safeResponse(result, tokens));
    } catch {
      res.status(502).json({ error: 'assessment_unavailable', message: 'The assessment could not be completed. Please try again.' });
    } finally {
      delete res.locals.caller;
    }
  });
  app.use((_req, res) => { res.status(404).json({ error: 'not_found', message: 'Endpoint not found.' }); });
  const sanitizedError: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(500).json({ error: 'internal_error', message: 'The API could not process this request.' });
  };
  app.use(sanitizedError);
  return app;
}
