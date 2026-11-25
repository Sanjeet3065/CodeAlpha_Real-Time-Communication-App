import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';
import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
} from './tokens.js';
import {
  getRefreshCookieOptions,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
} from './cookies.js';
import { registerSchema, loginSchema } from '../schemas/auth.schema.js';

describe('Security Utilities — Argon2id & JWT', () => {
  it('should hash and verify passwords using Argon2id', async () => {
    const rawPassword = 'StrongPassword123!';
    const hash = await hashPassword(rawPassword);

    assert.ok(hash.startsWith('$argon2id$'), 'Hash must use the argon2id algorithm');
    assert.ok(hash.includes('m=65536'), 'Memory cost must be 65536 KB (64MB)');
    assert.ok(hash.includes('t=3'), 'Time cost must be 3 iterations');
    assert.ok(hash.includes('p=1'), 'Parallelism must be 1 thread');

    const isValid = await verifyPassword(rawPassword, hash);
    assert.strictEqual(isValid, true, 'Valid password verification must succeed');

    const isInvalid = await verifyPassword('WrongPassword123!', hash);
    assert.strictEqual(isInvalid, false, 'Invalid password verification must fail');
  });

  it('should generate and verify JWT access tokens', () => {
    const payload = {
      sub: '6650a12f84b3e8a1d044a101',
      email: 'alex.morgan@connectly.io',
      firstName: 'Alex',
      lastName: 'Morgan',
    };

    const token = generateAccessToken(payload);
    assert.ok(typeof token === 'string' && token.length > 20);

    const decoded = verifyAccessToken(token);
    assert.strictEqual(decoded.sub, payload.sub);
    assert.strictEqual(decoded.email, payload.email);
    assert.strictEqual(decoded.firstName, payload.firstName);
    assert.strictEqual(decoded.lastName, payload.lastName);
  });

  it('should generate cryptographically random 64-hex-char refresh tokens', () => {
    const token1 = generateRefreshToken();
    const token2 = generateRefreshToken();

    assert.strictEqual(token1.length, 64);
    assert.strictEqual(token2.length, 64);
    assert.notStrictEqual(token1, token2);
    assert.match(token1, /^[0-9a-f]{64}$/);
  });

  it('should deterministically compute SHA-256 token hashes', () => {
    const token = 'sample_refresh_token_string_for_testing';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
  });
});

describe('Cookie Configuration & Security Options', () => {
  it('should enforce Secure=true, HttpOnly=true, SameSite=lax in production', () => {
    const prodOptions = getRefreshCookieOptions('production');

    assert.strictEqual(prodOptions.httpOnly, true, 'Production cookie must be HttpOnly');
    assert.strictEqual(prodOptions.secure, true, 'Production cookie must have Secure=true (HTTPS only)');
    assert.strictEqual(prodOptions.sameSite, 'lax', 'Production cookie must use SameSite=lax');
    assert.strictEqual(prodOptions.path, '/api', 'Cookie must be scoped strictly to /api');
    assert.strictEqual(prodOptions.maxAge, 7 * 24 * 60 * 60 * 1000, 'Cookie maxAge must be 7 days');
  });

  it('should permit Secure=false for localhost development while preserving HttpOnly=true and SameSite=lax', () => {
    const devOptions = getRefreshCookieOptions('development');

    assert.strictEqual(devOptions.httpOnly, true, 'Dev cookie must remain HttpOnly');
    assert.strictEqual(devOptions.secure, false, 'Dev cookie must have Secure=false for local HTTP');
    assert.strictEqual(devOptions.sameSite, 'lax', 'Dev cookie must use SameSite=lax');
    assert.strictEqual(devOptions.path, '/api', 'Dev cookie must be scoped to /api');
    assert.strictEqual(devOptions.maxAge, 7 * 24 * 60 * 60 * 1000);
  });

  it('should set and clear refresh cookies via Express response methods', () => {
    let setCookieCalled = false;
    let clearCookieCalled = false;

    const mockResSet = {
      cookie: (name: string, val: string, opts: any) => {
        setCookieCalled = true;
        assert.strictEqual(name, REFRESH_COOKIE_NAME);
        assert.strictEqual(val, 'dummy_token_64');
        assert.strictEqual(opts.httpOnly, true);
        assert.strictEqual(opts.path, '/api');
      },
    } as any;

    setRefreshCookie(mockResSet, 'dummy_token_64');
    assert.strictEqual(setCookieCalled, true);

    const mockResClear = {
      clearCookie: (name: string, opts: any) => {
        clearCookieCalled = true;
        assert.strictEqual(name, REFRESH_COOKIE_NAME);
        assert.strictEqual(opts.httpOnly, true);
        assert.strictEqual(opts.path, '/api');
        assert.strictEqual(opts.maxAge, undefined, 'clearCookie must not define maxAge');
      },
    } as any;

    clearRefreshCookie(mockResClear);
    assert.strictEqual(clearCookieCalled, true);
  });
});

describe('Input Validation Schemas', () => {
  it('should accept valid registration payloads', () => {
    const validData = {
      email: 'valid.user@connectly.io',
      password: 'SecurePassword123!',
      firstName: 'John',
      lastName: 'Doe',
    };

    const result = registerSchema.safeParse(validData);
    assert.strictEqual(result.success, true);
  });

  it('should reject registration payloads that fail complexity rules', () => {
    // Missing symbol
    const noSymbol = registerSchema.safeParse({
      email: 'user@test.com',
      password: 'Password123',
      firstName: 'A',
      lastName: 'B',
    });
    assert.strictEqual(noSymbol.success, false);

    // Missing uppercase
    const noUpper = registerSchema.safeParse({
      email: 'user@test.com',
      password: 'password123!',
      firstName: 'A',
      lastName: 'B',
    });
    assert.strictEqual(noUpper.success, false);

    // Less than 8 chars
    const tooShort = registerSchema.safeParse({
      email: 'user@test.com',
      password: 'Pass1!',
      firstName: 'A',
      lastName: 'B',
    });
    assert.strictEqual(tooShort.success, false);

    // Invalid email
    const badEmail = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'Password123!',
      firstName: 'A',
      lastName: 'B',
    });
    assert.strictEqual(badEmail.success, false);
  });

  it('should validate login payloads', () => {
    const validLogin = loginSchema.safeParse({
      email: 'user@connectly.io',
      password: 'AnyPassword123!',
    });
    assert.strictEqual(validLogin.success, true);

    const emptyPassword = loginSchema.safeParse({
      email: 'user@connectly.io',
      password: '',
    });
    assert.strictEqual(emptyPassword.success, false);
  });
});
