import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { RequestHandler } from 'express';
import { apiScopeName } from './config.ts';
import type { ApiConfig } from './config.ts';

export type Caller = { assertion: string; tenantId: string; objectId: string };
class InsufficientScope extends Error {}

export function createTokenValidator(config: ApiConfig, testKeys?: JWTVerifyGetKey) {
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  // Trust configured tenant discovery only, never jku/x5u or issuer supplied by a token.
  const keys = testKeys ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
    { timeoutDuration: 5000, cooldownDuration: 30000 });
  return async (assertion: string): Promise<Caller> => {
    const { payload } = await jwtVerify(assertion, keys, {
      issuer, audience: config.clientId, algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'exp', 'nbf', 'iat', 'tid', 'oid', 'ver', 'azp'],
      clockTolerance: 5,
    });
    if (payload.ver !== '2.0' || payload.tid !== config.tenantId || payload.aud !== config.clientId ||
      payload.azp !== config.spaClientId || typeof payload.oid !== 'string' || !payload.oid) throw new Error('Invalid caller');
    // Reject app-only tokens and ID tokens, even if signed by Entra.
    if (typeof payload.scp !== 'string' || !payload.scp.split(' ').includes(apiScopeName)) throw new InsufficientScope();
    return { assertion, tenantId: config.tenantId, objectId: payload.oid };
  };
}

export function authenticate(validate: ReturnType<typeof createTokenValidator>): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([^\s,]+)$/i.exec(header) : null;
    if (!match?.[1]) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'authentication_required', message: 'Sign in to access the assessment API.' });
      return;
    }
    try {
      res.locals.caller = await validate(match[1]);
      next();
    } catch (error) {
      if (error instanceof InsufficientScope) {
        res.status(403).json({ error: 'insufficient_scope', message: 'Delegated assessment permission is required.' });
      } else {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        res.status(401).json({ error: 'invalid_token', message: 'The API access token could not be validated. Sign in again.' });
      }
    }
  };
}
