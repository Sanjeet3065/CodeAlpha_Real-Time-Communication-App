import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { env } from '../config/env.js';

export interface GoogleAuthConfig {
  clientId?: string;
  clientSecret?: string;
}

export interface VerifiedGoogleProfile {
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  subjectId: string;
}

export type GoogleAuthErrorCode =
  | 'GOOGLE_AUTH_NOT_CONFIGURED'
  | 'GOOGLE_EMAIL_NOT_VERIFIED'
  | 'GOOGLE_INVALID_CODE';

export class GoogleAuthError extends Error {
  code: GoogleAuthErrorCode;

  constructor(code: GoogleAuthErrorCode, message: string) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }
}

export function isGoogleAuthConfigured(config: GoogleAuthConfig = {
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
}): boolean {
  const clientId = (config.clientId || '').trim();
  const clientSecret = (config.clientSecret || '').trim();
  return clientId.length > 0 && clientSecret.length > 0;
}

export function isAllowedGoogleRedirectUri(
  redirectUri: string,
  clientOrigin: string = env.CLIENT_ORIGIN,
  nodeEnv: string = env.NODE_ENV
): boolean {
  const normalized = redirectUri.trim();
  if (normalized === 'postmessage') {
    return true;
  }

  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(normalized);
  } catch {
    return false;
  }

  const allowedOrigins =
    nodeEnv === 'production'
      ? [clientOrigin]
      : [clientOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'];

  return allowedOrigins.some((originCandidate) => {
    try {
      return parsedRedirect.origin === new URL(originCandidate.trim()).origin;
    } catch {
      return false;
    }
  });
}

export function sanitizeGoogleNameParts(payload: Pick<TokenPayload, 'given_name' | 'family_name' | 'name'>): {
  firstName: string;
  lastName: string;
} {
  const rawGiven = (payload.given_name || '').trim();
  const rawFamily = (payload.family_name || '').trim();
  const fullName = (payload.name || '').trim();

  let firstName = rawGiven;
  let lastName = rawFamily;

  if (!firstName && fullName) {
    const firstSpace = fullName.indexOf(' ');
    if (firstSpace === -1) {
      firstName = fullName;
    } else {
      firstName = fullName.slice(0, firstSpace).trim();
      if (!lastName) {
        lastName = fullName.slice(firstSpace + 1).trim();
      }
    }
  }

  const cleanFirst = (firstName || 'User').slice(0, 50) || 'User';
  const cleanLast = (lastName || 'Account').slice(0, 50) || 'Account';

  return {
    firstName: cleanFirst,
    lastName: cleanLast,
  };
}

export async function verifyGoogleAuthorizationCode(
  code: string,
  redirectUri = 'postmessage',
  config: GoogleAuthConfig = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  }
): Promise<VerifiedGoogleProfile> {
  const clientId = (config.clientId || '').trim();
  const clientSecret = (config.clientSecret || '').trim();

  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      'GOOGLE_AUTH_NOT_CONFIGURED',
      'Google OAuth is not configured on the server.'
    );
  }

  const oauthClient = new OAuth2Client(clientId, clientSecret, redirectUri);

  let idToken: string | null | undefined;
  try {
    const tokenResult = await oauthClient.getToken({
      code,
      redirect_uri: redirectUri,
    });
    idToken = tokenResult.tokens.id_token;
  } catch {
    throw new GoogleAuthError(
      'GOOGLE_INVALID_CODE',
      'Unable to exchange Google authorization code. Please try signing in again.'
    );
  }

  if (!idToken) {
    throw new GoogleAuthError(
      'GOOGLE_INVALID_CODE',
      'Google OAuth response did not include an identity token.'
    );
  }

  let payload: TokenPayload | undefined;
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new GoogleAuthError(
      'GOOGLE_INVALID_CODE',
      'Google identity token verification failed.'
    );
  }

  if (!payload?.email || !payload?.sub) {
    throw new GoogleAuthError(
      'GOOGLE_INVALID_CODE',
      'Google profile did not provide a valid account identifier and email.'
    );
  }

  if (payload.email_verified !== true) {
    throw new GoogleAuthError(
      'GOOGLE_EMAIL_NOT_VERIFIED',
      'Your Google account email must be verified before signing in.'
    );
  }

  const { firstName, lastName } = sanitizeGoogleNameParts(payload);
  const avatarUrl =
    payload.picture && payload.picture.startsWith('https://') ? payload.picture : null;

  return {
    email: payload.email.toLowerCase().trim(),
    emailVerified: true,
    firstName,
    lastName,
    avatarUrl,
    subjectId: payload.sub,
  };
}
