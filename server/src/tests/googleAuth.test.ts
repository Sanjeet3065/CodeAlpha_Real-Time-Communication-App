import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  sanitizeGoogleNameParts,
  isGoogleAuthConfigured,
  isAllowedGoogleRedirectUri,
  GoogleAuthError,
} from '../services/googleAuth.service.js';
import { googleAuthSchema } from '../schemas/auth.schema.js';
import { googleAuth, getGoogleAuthConfig } from '../controllers/auth.controller.js';

function createMockResponse() {
  const state: {
    statusCode: number;
    body: any;
    cookies: Array<{ name: string; value: string; options: any }>;
  } = {
    statusCode: 200,
    body: null,
    cookies: [],
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
    cookie(name: string, value: string, options: unknown) {
      state.cookies.push({ name, value, options });
      return res;
    },
  } as unknown as Response;

  return { res, state };
}

describe('Google OAuth Authentication — Service, Schema & Controller Suite', () => {
  it('1. Validates Google OAuth configuration presence strictly', () => {
    assert.strictEqual(isGoogleAuthConfigured({ clientId: '', clientSecret: '' }), false);
    assert.strictEqual(isGoogleAuthConfigured({ clientId: 'cid.apps.googleusercontent.com', clientSecret: '' }), false);
    assert.strictEqual(
      isGoogleAuthConfigured({
        clientId: '12345.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-real-secret',
      }),
      true
    );
  });

  it('2. Restricts Google redirectUri strictly to postmessage or trusted origin', () => {
    assert.strictEqual(isAllowedGoogleRedirectUri('postmessage', 'https://connectly-meet.vercel.app', 'production'), true);
    assert.strictEqual(
      isAllowedGoogleRedirectUri('https://connectly-meet.vercel.app', 'https://connectly-meet.vercel.app', 'production'),
      true
    );
    assert.strictEqual(
      isAllowedGoogleRedirectUri('https://evil.example.com/steal', 'https://connectly-meet.vercel.app', 'production'),
      false
    );
    assert.strictEqual(
      isAllowedGoogleRedirectUri('http://localhost:5173', 'https://connectly-meet.vercel.app', 'production'),
      false
    );
    assert.strictEqual(
      isAllowedGoogleRedirectUri('http://localhost:5173', 'http://localhost:5173', 'development'),
      true
    );
  });

  it('3. Sanitizes Google profile names cleanly including single-name accounts', () => {
    assert.deepStrictEqual(
      sanitizeGoogleNameParts({ given_name: 'Sanjeet', family_name: 'Chauhan' }),
      { firstName: 'Sanjeet', lastName: 'Chauhan' }
    );
    assert.deepStrictEqual(
      sanitizeGoogleNameParts({ name: 'Alex Morgan Taylor' }),
      { firstName: 'Alex', lastName: 'Morgan Taylor' }
    );
    assert.deepStrictEqual(
      sanitizeGoogleNameParts({ name: 'Sanjeet' }),
      { firstName: 'Sanjeet', lastName: 'Account' }
    );
    assert.deepStrictEqual(sanitizeGoogleNameParts({}), { firstName: 'User', lastName: 'Account' });
  });

  it('4. googleAuthSchema requires non-empty authorization code and defaults redirectUri', () => {
    const valid = googleAuthSchema.safeParse({ code: '4/0AeanS0_sample_code' });
    assert.strictEqual(valid.success, true);
    if (valid.success) {
      assert.strictEqual(valid.data.redirectUri, 'postmessage');
    }

    const empty = googleAuthSchema.safeParse({ code: '   ' });
    assert.strictEqual(empty.success, false);
  });

  it('5. GET /auth/google/config reports enabled status and public clientId without exposing secret', async () => {
    const { res, state } = createMockResponse();
    await getGoogleAuthConfig({} as Request, res, {
      clientId: '12345.apps.googleusercontent.com',
      clientSecret: 'super-secret-value',
    });
    assert.strictEqual(state.statusCode, 200);
    assert.deepStrictEqual(state.body, {
      enabled: true,
      clientId: '12345.apps.googleusercontent.com',
    });
    assert.strictEqual(JSON.stringify(state.body).includes('super-secret-value'), false);
  });

  it('6. POST /auth/google fails closed (503) when Google OAuth secrets are absent', async () => {
    const req = { body: { code: 'valid-code', redirectUri: 'postmessage' }, headers: {}, ip: '127.0.0.1' } as unknown as Request;
    const { res, state } = createMockResponse();

    await googleAuth(req, res, {
      googleConfig: { clientId: '', clientSecret: '' },
    });

    assert.strictEqual(state.statusCode, 503);
    assert.strictEqual(state.body.code, 'GOOGLE_AUTH_NOT_CONFIGURED');
  });

  it('7. POST /auth/google creates a verified user with Argon2id hash & issues session on first Google sign-in', async () => {
    let createdDoc: any = null;
    let createdSession: any = null;

    const req = {
      body: { code: 'google-auth-code', redirectUri: 'postmessage' },
      headers: { 'user-agent': 'VitestBrowser/1.0' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const { res, state } = createMockResponse();

    await googleAuth(req, res, {
      googleConfig: { clientId: '123.apps.googleusercontent.com', clientSecret: 'sec-123' },
      clientOrigin: 'https://connectly-meet.vercel.app',
      nodeEnv: 'production',
      verifyCodeFn: async () => ({
        email: 'new.user@gmail.com',
        emailVerified: true,
        firstName: 'New',
        lastName: 'User',
        avatarUrl: 'https://lh3.googleusercontent.com/a/avatar123',
        subjectId: 'google-sub-123',
      }),
      findUserByEmail: async () => null,
      createUser: async (payload) => {
        createdDoc = {
          _id: '507f1f77bcf86cd799439011',
          role: 'user',
          ...payload,
        };
        return createdDoc;
      },
      createSession: async (sessionData) => {
        createdSession = sessionData;
      },
      resolvePreferences: async () => ({
        defaultAudioMuted: true,
        defaultVideoOff: false,
        enableVirtualBackground: false,
        theme: 'editorial-light',
        notificationSounds: true,
      }),
      auditLog: () => {},
    });

    assert.strictEqual(state.statusCode, 200);
    assert.strictEqual(state.body.success, true);
    assert.ok(state.body.accessToken);
    assert.strictEqual(state.body.user.email, 'new.user@gmail.com');
    assert.strictEqual(state.body.user.isEmailVerified, true);
    assert.strictEqual(state.body.user.avatarUrl, 'https://lh3.googleusercontent.com/a/avatar123');
    assert.ok(createdDoc.passwordHash.startsWith('$argon2id$'));
    assert.ok(createdSession?.refreshTokenHash);
    assert.strictEqual(state.cookies.length, 1);
    assert.strictEqual(state.cookies[0].name, 'connectly_refresh');
  });

  it('8. POST /auth/google rejects unverified Google accounts with 401', async () => {
    const req = {
      body: { code: 'unverified-code', redirectUri: 'postmessage' },
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const { res, state } = createMockResponse();

    await googleAuth(req, res, {
      googleConfig: { clientId: '123.apps.googleusercontent.com', clientSecret: 'sec-123' },
      clientOrigin: 'https://connectly-meet.vercel.app',
      nodeEnv: 'production',
      verifyCodeFn: async () => {
        throw new GoogleAuthError('GOOGLE_EMAIL_NOT_VERIFIED', 'Google account email must be verified.');
      },
    });

    assert.strictEqual(state.statusCode, 401);
    assert.strictEqual(state.body.code, 'GOOGLE_EMAIL_NOT_VERIFIED');
  });
});
