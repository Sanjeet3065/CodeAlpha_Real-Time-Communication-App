import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User, type IUser } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
import { env } from '../config/env.js';
import { userService } from '../services/user.service.js';
import {
  GoogleAuthError,
  isAllowedGoogleRedirectUri,
  isGoogleAuthConfigured,
  verifyGoogleAuthorizationCode,
  type GoogleAuthConfig,
  type VerifiedGoogleProfile,
} from '../services/googleAuth.service.js';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../utils/password.js';
import { securityAudit } from '../utils/securityAudit.js';
import {
  generateAccessToken,
  generateRefreshToken,
  generateFamilyId,
  hashToken,
} from '../utils/tokens.js';
import {
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
} from '../utils/cookies.js';

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, firstName, lastName } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      res.status(409).json({
        status: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email address already exists.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const passwordHash = await hashPassword(password);

    const newUser = await User.create({
      email: normalizedEmail,
      passwordHash,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Verification email dispatched.',
      user: {
        id: newUser._id.toString(),
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
    });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
      res.status(409).json({
        status: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email address already exists.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    console.error('[Auth Controller] Register error:', error);
    res.status(500).json({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during registration.',
      timestamp: new Date().toISOString(),
    });
  }
}

export interface FailedLoginResult {
  failedLoginAttempts: number;
  lockoutUntil: Date | null;
  isLocked: boolean;
}

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * DEF-15-05: Atomically records a failed login attempt with hardened lockout guarantees:
 * 1. Establishes lockout start atomically when threshold (5) is first reached.
 * 2. Subsequent failed attempts during an active lockout NEVER extend its existing expiry.
 * 3. Expired lockouts (lockoutUntil <= now) follow a safe recovery policy:
 *    the expired counter resets and this attempt is counted as attempt #1, clearing lockoutUntil.
 * 4. Concurrent failed attempts are executed atomically via a 3-stage MongoDB update pipeline.
 */
export async function recordFailedLoginAttempt(
  userId: mongoose.Types.ObjectId | string,
  currentTime: Date = new Date()
): Promise<FailedLoginResult> {
  const lockoutExpiry = new Date(currentTime.getTime() + LOCKOUT_DURATION_MS);

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          effectiveBaseAttempts: {
            $cond: {
              if: {
                $and: [
                  { $ne: [{ $type: '$lockoutUntil' }, 'missing'] },
                  { $ne: ['$lockoutUntil', null] },
                  { $lte: ['$lockoutUntil', currentTime] },
                ],
              },
              then: 0,
              else: { $ifNull: ['$failedLoginAttempts', 0] },
            },
          },
          isAlreadyLocked: {
            $and: [
              { $ne: [{ $type: '$lockoutUntil' }, 'missing'] },
              { $ne: ['$lockoutUntil', null] },
              { $gt: ['$lockoutUntil', currentTime] },
            ],
          },
        },
      },
      {
        $set: {
          failedLoginAttempts: { $add: ['$effectiveBaseAttempts', 1] },
          lockoutUntil: {
            $cond: {
              if: '$isAlreadyLocked',
              then: '$lockoutUntil', // DEF-15-05: Preserve active lockout expiry without extension
              else: {
                $cond: {
                  if: { $gte: [{ $add: ['$effectiveBaseAttempts', 1] }, LOCKOUT_THRESHOLD] },
                  then: lockoutExpiry, // Atomically establish lockout start
                  else: null,
                },
              },
            },
          },
        },
      },
      {
        $unset: ['effectiveBaseAttempts', 'isAlreadyLocked'],
      },
    ],
    { new: true }
  );

  const lockoutUntil = updatedUser?.lockoutUntil ?? null;
  const isLocked = !!(lockoutUntil && lockoutUntil.getTime() > currentTime.getTime());

  return {
    failedLoginAttempts: updatedUser?.failedLoginAttempts ?? 1,
    lockoutUntil,
    isLocked,
  };
}

export interface SessionUserLike {
  _id: mongoose.Types.ObjectId | string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  role?: 'user' | 'admin' | string;
  isEmailVerified?: boolean;
  preferences?: IUser['preferences'];
}

export interface GoogleAuthDeps {
  googleConfig?: GoogleAuthConfig;
  clientOrigin?: string;
  nodeEnv?: string;
  verifyCodeFn?: (
    code: string,
    redirectUri?: string,
    config?: GoogleAuthConfig
  ) => Promise<VerifiedGoogleProfile>;
  findUserByEmail?: (
    email: string
  ) => Promise<(SessionUserLike & { failedLoginAttempts?: number; lockoutUntil?: Date | null }) | null>;
  createUser?: (payload: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    isEmailVerified: boolean;
  }) => Promise<SessionUserLike>;
  resetLockoutAndVerify?: (user: SessionUserLike, avatarUrl: string | null) => Promise<void>;
  createSession?: (payload: {
    userId: unknown;
    familyId: string;
    refreshTokenHash: string;
    userAgent: string;
    ipAddress: string;
    isValid: boolean;
    expiresAt: Date;
  }) => Promise<unknown>;
  resolvePreferences?: (user: any) => Promise<unknown>;
  auditLog?: typeof securityAudit.log;
}

async function issueAuthenticatedSession(
  req: Request,
  res: Response,
  user: SessionUserLike,
  options?: {
    details?: Record<string, unknown>;
    createSession?: GoogleAuthDeps['createSession'];
    resolvePreferences?: GoogleAuthDeps['resolvePreferences'];
    auditLog?: typeof securityAudit.log;
  }
): Promise<void> {
  const userIdStr = String(user._id);
  const logFn = options?.auditLog ?? ((entry) => securityAudit.log(entry));
  const createSessionFn =
    options?.createSession ?? ((payload) => AuthSession.create(payload));
  const resolvePrefsFn =
    options?.resolvePreferences ?? ((u) => userService.resolveUserPreferences(u));

  logFn({
    eventType: 'AUTH_LOGIN_SUCCESS',
    userId: userIdStr,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'] as string,
    details: options?.details,
  });

  const accessToken = generateAccessToken({
    sub: userIdStr,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role || 'user',
  });

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const familyId = generateFamilyId();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await createSessionFn({
    userId: user._id,
    familyId,
    refreshTokenHash,
    userAgent: (req.headers['user-agent'] as string) || 'Unknown',
    ipAddress: req.ip || req.socket.remoteAddress || 'Unknown',
    isValid: true,
    expiresAt,
  });

  setRefreshCookie(res, refreshToken);

  const resolvedPreferences = await resolvePrefsFn(user);

  res.status(200).json({
    success: true,
    user: {
      id: userIdStr,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl ?? null,
      isEmailVerified: Boolean(user.isEmailVerified),
      preferences: resolvedPreferences,
    },
    accessToken,
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Mitigate account enumeration via timing analysis: perform dummy argon2 verification
      await verifyDummyPassword(password);
      securityAudit.log({
        eventType: 'AUTH_TIMING_DEFENSE_TRIGGERED',
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
      });
      securityAudit.log({
        eventType: 'AUTH_LOGIN_FAILURE',
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
        details: { reason: 'User not found' },
      });
      res.status(401).json({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Check account-level lockout
    const now = new Date();
    if (user.lockoutUntil && user.lockoutUntil > now) {
      // DEF-15-05: Timing defense — maintain constant Argon2id verification latency
      await verifyDummyPassword(password);

      const remainingMinutes = Math.max(
        1,
        Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / (60 * 1000))
      );
      securityAudit.log({
        eventType: 'AUTH_ACCOUNT_LOCKED',
        userId: user._id.toString(),
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
        details: { remainingMinutes },
      });

      // DEF-15-05: Uniform public response (HTTP 401 INVALID_CREDENTIALS)
      // Completely neutralizes account enumeration and targeted DoS confirmation
      res.status(401).json({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      // DEF-15-05: Record failed login attempt atomically with non-extension and safe recovery
      const failedResult = await recordFailedLoginAttempt(user._id, now);

      if (failedResult.isLocked) {
        securityAudit.log({
          eventType: 'AUTH_ACCOUNT_LOCKED',
          userId: user._id.toString(),
          ip: req.ip || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'] as string,
          details: {
            failedAttempts: failedResult.failedLoginAttempts,
            lockoutMinutes: 15,
          },
        });
      } else {
        securityAudit.log({
          eventType: 'AUTH_LOGIN_FAILURE',
          userId: user._id.toString(),
          ip: req.ip || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'] as string,
          details: { failedAttempts: failedResult.failedLoginAttempts },
        });
      }

      res.status(401).json({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Reset lockout counters atomically on successful authentication
    if ((user.failedLoginAttempts || 0) > 0 || user.lockoutUntil) {
      await User.updateOne(
        { _id: user._id },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockoutUntil: 1 } }
      );
    }

    await issueAuthenticatedSession(req, res, user);
  } catch (error) {
    console.error('[Auth Controller] Login error:', error);
    res.status(500).json({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during login.',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function getGoogleAuthConfig(
  _req: Request,
  res: Response,
  configOverride?: GoogleAuthConfig
): Promise<void> {
  const cfg = configOverride ?? {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
  const enabled = isGoogleAuthConfigured(cfg);
  res.status(200).json({
    enabled,
    clientId: enabled ? (cfg.clientId || '').trim() : null,
  });
}

export async function googleAuth(
  req: Request,
  res: Response,
  deps: GoogleAuthDeps = {}
): Promise<void> {
  try {
    const googleConfig = deps.googleConfig ?? {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };

    if (!isGoogleAuthConfigured(googleConfig)) {
      res.status(503).json({
        status: 503,
        code: 'GOOGLE_AUTH_NOT_CONFIGURED',
        message: 'Google sign-in is not yet configured on this server.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const redirectUri =
      typeof req.body?.redirectUri === 'string' && req.body.redirectUri.trim()
        ? req.body.redirectUri.trim()
        : 'postmessage';

    if (!code) {
      res.status(400).json({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Google authorization code is required.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const clientOrigin = deps.clientOrigin ?? env.CLIENT_ORIGIN;
    const nodeEnv = deps.nodeEnv ?? env.NODE_ENV;
    if (!isAllowedGoogleRedirectUri(redirectUri, clientOrigin, nodeEnv)) {
      res.status(400).json({
        status: 400,
        code: 'INVALID_REDIRECT_URI',
        message: 'Redirect URI is not authorized for Google authentication.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const verifyFn = deps.verifyCodeFn ?? verifyGoogleAuthorizationCode;
    const profile = await verifyFn(code, redirectUri, googleConfig);

    const findUserFn =
      deps.findUserByEmail ?? ((email: string) => User.findOne({ email }));
    const createUserFn =
      deps.createUser ?? ((payload) => User.create(payload));
    const resetFn =
      deps.resetLockoutAndVerify ??
      (async (existingUser: SessionUserLike, avatarUrl: string | null) => {
        const updateSet: Record<string, unknown> = {
          failedLoginAttempts: 0,
          isEmailVerified: true,
        };
        if (!existingUser.avatarUrl && avatarUrl) {
          updateSet.avatarUrl = avatarUrl;
          existingUser.avatarUrl = avatarUrl;
        }
        existingUser.isEmailVerified = true;
        await User.updateOne(
          { _id: existingUser._id },
          { $set: updateSet, $unset: { lockoutUntil: 1 } }
        );
      });

    let user = await findUserFn(profile.email);
    let isNewAccount = false;

    if (!user) {
      isNewAccount = true;
      const randomSentinel = crypto.randomBytes(48).toString('base64url');
      const passwordHash = await hashPassword(randomSentinel);

      try {
        user = await createUserFn({
          email: profile.email,
          passwordHash,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatarUrl: profile.avatarUrl,
          isEmailVerified: true,
        });
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000) {
          user = await findUserFn(profile.email);
          isNewAccount = false;
        } else {
          throw err;
        }
      }
    } else {
      await resetFn(user, profile.avatarUrl);
    }

    if (!user) {
      res.status(500).json({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to load user profile after Google sign-in.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    await issueAuthenticatedSession(req, res, user, {
      details: { authProvider: 'google', isNewAccount },
      createSession: deps.createSession,
      resolvePreferences: deps.resolvePreferences,
      auditLog: deps.auditLog,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      const status = error.code === 'GOOGLE_AUTH_NOT_CONFIGURED' ? 503 : 401;
      res.status(status).json({
        status,
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    console.error('[Auth Controller] Google Auth error:', error);
    res.status(500).json({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during Google authentication.',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(401).json({
        status: 401,
        code: 'MISSING_REFRESH_TOKEN',
        message: 'Refresh token is missing or not provided.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const hashedToken = hashToken(refreshToken);

    // Atomically find and invalidate active session to avoid race conditions
    const activeSession = await AuthSession.findOneAndUpdate(
      { refreshTokenHash: hashedToken, isValid: true },
      { isValid: false, rotatedAt: new Date() },
      { new: false }
    );

    // If an active session was found and rotated atomically
    if (activeSession) {
      // Check expiration
      if (new Date() > activeSession.expiresAt) {
        clearRefreshCookie(res);
        res.status(401).json({
          status: 401,
          code: 'TOKEN_EXPIRED',
          message: 'Refresh token has expired. Please log in again.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const user = await User.findById(activeSession.userId);
      if (!user) {
        clearRefreshCookie(res);
        res.status(401).json({
          status: 401,
          code: 'USER_NOT_FOUND',
          message: 'User account no longer exists.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Issue new rotated refresh token & session inheriting the same familyId
      const newRefreshToken = generateRefreshToken();
      const newRefreshTokenHash = hashToken(newRefreshToken);
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await AuthSession.create({
        userId: user._id,
        familyId: activeSession.familyId,
        refreshTokenHash: newRefreshTokenHash,
        userAgent: (req.headers['user-agent'] as string) || activeSession.userAgent,
        ipAddress: req.ip || req.socket.remoteAddress || activeSession.ipAddress,
        isValid: true,
        expiresAt: newExpiresAt,
      });

      const newAccessToken = generateAccessToken({
        sub: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role || 'user',
      });

      setRefreshCookie(res, newRefreshToken);

      securityAudit.log({
        eventType: 'AUTH_TOKEN_ROTATION',
        userId: user._id.toString(),
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] as string,
        details: { familyId: activeSession.familyId },
      });

      const resolvedPreferences = await userService.resolveUserPreferences(user);

      res.status(200).json({
        success: true,
        accessToken: newAccessToken,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          isEmailVerified: user.isEmailVerified,
          preferences: resolvedPreferences,
        },
      });
      return;
    }

    // Active session was NOT found. Check if an invalidated session exists (Reuse detection)
    const existingSession = await AuthSession.findOne({ refreshTokenHash: hashedToken });

    if (!existingSession) {
      clearRefreshCookie(res);
      res.status(401).json({
        status: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or does not exist.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Session exists but was already invalidated.
    // Check if this was a concurrent race within the 5-second rotation window:
    const now = Date.now();
    const rotatedAtMs = existingSession.rotatedAt
      ? new Date(existingSession.rotatedAt).getTime()
      : 0;
    const isConcurrentRace = rotatedAtMs > 0 && now - rotatedAtMs < 5000;

    if (isConcurrentRace) {
      console.warn(
        `[Security] Concurrent token refresh race detected within grace window for family: ${existingSession.familyId}`
      );
      res.status(401).json({
        status: 401,
        code: 'CONCURRENT_REFRESH',
        message: 'Token was freshly rotated by a concurrent request. Please use the newest session token.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Genuine token reuse: The rotated token was replayed outside the grace window.
    // Revoke the affected token family to isolate the breach.
    console.warn(
      `[Security] Token reuse detected for family ${existingSession.familyId} (userId: ${existingSession.userId}). Revoking token family.`
    );
    securityAudit.log({
      eventType: 'AUTH_TOKEN_REUSE_DETECTED',
      userId: existingSession.userId.toString(),
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
      details: { familyId: existingSession.familyId },
    });
    await AuthSession.updateMany({ familyId: existingSession.familyId }, { isValid: false });
    clearRefreshCookie(res);

    res.status(401).json({
      status: 401,
      code: 'TOKEN_REUSE_DETECTED',
      message: 'Potential security breach: rotated token was replayed. Affected session family revoked.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Auth Controller] Refresh error:', error);
    res.status(500).json({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during token refresh.',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

    if (refreshToken && typeof refreshToken === 'string') {
      const hashedToken = hashToken(refreshToken);
      const session = await AuthSession.findOne({ refreshTokenHash: hashedToken });
      if (session) {
        // Revoke the specific session family
        await AuthSession.updateMany({ familyId: session.familyId }, { isValid: false });
      }
    } else if (req.user?.sub) {
      // Invalidate active sessions if explicitly authenticated via access token
      await AuthSession.updateMany(
        { userId: req.user.sub, isValid: true },
        { isValid: false }
      );
    }

    clearRefreshCookie(res);

    securityAudit.log({
      eventType: 'AUTH_SESSION_REVOKED',
      userId: req.user?.sub,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    });

    res.status(200).json({
      success: true,
      message: 'Successfully logged out.',
    });
  } catch (error) {
    console.error('[Auth Controller] Logout error:', error);
    clearRefreshCookie(res);
    res.status(500).json({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during logout.',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user?.sub) {
      res.status(401).json({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const user = await User.findById(req.user.sub);
    if (!user) {
      res.status(404).json({
        status: 404,
        code: 'USER_NOT_FOUND',
        message: 'User account not found.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const resolvedPreferences = await userService.resolveUserPreferences(user);

    res.status(200).json({
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      preferences: resolvedPreferences,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('[Auth Controller] GetMe error:', error);
    res.status(500).json({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred while fetching user profile.',
      timestamp: new Date().toISOString(),
    });
  }
}
