import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { User, type AvatarAccentColor, type IUser } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
import {
  UserPreferences,
  type IUserPreferencesDoc,
  type IPreferenceFieldVersions,
} from '../models/UserPreferences.model.js';
import {
  AppError,
  NotFoundError,
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '../utils/errors.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { securityAudit } from '../utils/securityAudit.js';
import { generateAccessToken, generateRefreshToken, hashToken } from '../utils/tokens.js';
import type {
  UpdateProfileInput,
  UpdatePreferencesInput,
  UpdateEmailInput,
  UpdatePasswordInput,
} from '../schemas/user.schema.js';

/**
 * Maximum permitted client clock lead ahead of server UTC time (30 seconds).
 * Any clientTimestamp beyond serverNow + MAX_FUTURE_CLOCK_SKEW_MS is rejected
 * with HTTP 400 INVALID_CLIENT_TIMESTAMP so a future-dated or malicious client
 * clock can never poison MongoDB preference ordering.
 */
export const MAX_FUTURE_CLOCK_SKEW_MS = 30_000;

export interface ResolvedUserPreferences {
  defaultAudioMuted: boolean;
  defaultVideoOff: boolean;
  enableVirtualBackground: boolean;
  theme: string;
  notificationSounds: boolean;
}

export interface UserProfileResponse {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: AvatarAccentColor;
  jobTitle: string | null;
  bio: string | null;
  timeZone: string | null;
  hasLocalPassword: boolean;
  isEmailVerified: boolean;
  preferences: ResolvedUserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialMutationContext {
  callerFamilyId?: string;
  rawRefreshToken?: string;
  ip?: string;
  userAgent?: string;
}

export interface CredentialMutationResult {
  user: UserProfileResponse;
  accessToken: string;
  rotatedRefreshToken?: string;
}

export function buildUserProfileResponse(
  user: IUser,
  preferences: ResolvedUserPreferences
): UserProfileResponse {
  return {
    id: user._id.toString(),
    name: `${user.firstName} ${user.lastName}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    avatarUrl: user.avatarUrl || null,
    avatarColor: user.avatarColor || 'sage',
    jobTitle: user.jobTitle || null,
    bio: user.bio || null,
    timeZone: user.timeZone || null,
    hasLocalPassword: user.hasLocalPassword !== false,
    isEmailVerified: Boolean(user.isEmailVerified),
    preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export interface UserPreferencesResponse {
  defaultAudioMuted: boolean;
  defaultVideoOff: boolean;
  version: number;
  fieldVersions: IPreferenceFieldVersions;
  staleIgnored?: boolean;
  updatedAt: Date;
}

export interface UpdatePreferencesExecutionOptions {
  /**
   * Optional test-only hook invoked after baseline existence seeding and right
   * before executing the single atomic MongoDB findOneAndUpdate pipeline.
   * Used by deterministic two-instance race tests to force interleaved execution.
   */
  beforeAtomicWrite?: () => Promise<void>;
  /**
   * Optional test-only hook invoked after the authoritative user_preferences
   * write commits and right before executing the legacy User.preferences mirror.
   */
  beforeLegacyMirror?: () => Promise<void>;
  /**
   * Optional clock override for deterministic timestamp tests.
   */
  nowMs?: number;
}

export class UserService {
  // Process-local per-user serialization queue (single-instance throughput optimization ONLY).
  // Cross-instance consistency and atomicity are enforced directly by MongoDB's
  // single-document aggregation-pipeline findOneAndUpdate and server-controlled versions.
  private readonly userMutationQueues = new Map<string, Promise<unknown>>();

  private enqueueUserMutation<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.userMutationQueues.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => task());
    const tracked = next
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        if (this.userMutationQueues.get(userId) === tracked) {
          this.userMutationQueues.delete(userId);
        }
      });
    this.userMutationQueues.set(userId, tracked);
    return next;
  }

  /**
   * Resolves authoritative user preferences.
   *
   * Single Source of Truth Precedence Rule:
   * 1. `user_preferences` collection is the sole authoritative store for
   *    `defaultAudioMuted` and `defaultVideoOff`.
   * 2. Legacy embedded `users.preferences` is consulted ONLY as a read-only
   *    fallback when no `user_preferences` document exists yet for the user.
   * 3. System defaults apply if neither record provides a value.
   */
  async resolveUserPreferences(user: IUser): Promise<ResolvedUserPreferences> {
    const userPref = await UserPreferences.findOne({ userId: user._id });
    return {
      defaultAudioMuted: userPref
        ? userPref.defaultAudioMuted
        : (user.preferences?.defaultAudioMuted ?? true),
      defaultVideoOff: userPref
        ? userPref.defaultVideoOff
        : (user.preferences?.defaultVideoOff ?? false),
      enableVirtualBackground: user.preferences?.enableVirtualBackground ?? false,
      theme: user.preferences?.theme ?? 'editorial-light',
      notificationSounds: user.preferences?.notificationSounds ?? true,
    };
  }

  async getProfile(userId: string): Promise<UserProfileResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier format.', 'INVALID_IDENTIFIER');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
    }

    const preferences = await this.resolveUserPreferences(user);

    return buildUserProfileResponse(user, preferences);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfileResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier format.', 'INVALID_IDENTIFIER');
    }

    const updateSet: Record<string, string | null> = {};
    if (input.firstName !== undefined) {
      updateSet.firstName = input.firstName.trim();
    }
    if (input.lastName !== undefined) {
      updateSet.lastName = input.lastName.trim();
    }
    if (input.jobTitle !== undefined) {
      const cleaned = input.jobTitle === null ? '' : input.jobTitle.trim();
      updateSet.jobTitle = cleaned.length > 0 ? cleaned : null;
    }
    if (input.bio !== undefined) {
      const cleaned = input.bio === null ? '' : input.bio.trim();
      updateSet.bio = cleaned.length > 0 ? cleaned : null;
    }
    if (input.timeZone !== undefined) {
      const cleaned = input.timeZone === null ? '' : input.timeZone.trim();
      updateSet.timeZone = cleaned.length > 0 ? cleaned : null;
    }
    if (input.avatarColor !== undefined) {
      updateSet.avatarColor = input.avatarColor;
    }

    // Atomic field-level $set ensures profile updates can NEVER overwrite embedded preferences
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateSet },
      { new: true, runValidators: true }
    );
    if (!user) {
      throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
    }

    securityAudit.log({
      eventType: 'AUTH_PROFILE_UPDATED',
      userId: user._id.toString(),
      details: { updatedFields: Object.keys(updateSet) },
    });

    const preferences = await this.resolveUserPreferences(user);

    return buildUserProfileResponse(user, preferences);
  }

  private async resolveCallerFamilyAndRotate(
    userId: Types.ObjectId,
    ctx: CredentialMutationContext
  ): Promise<{ familyId?: string; rotatedRefreshToken?: string }> {
    let familyId = ctx.callerFamilyId;
    let rotatedRefreshToken: string | undefined;

    if (ctx.rawRefreshToken) {
      const hashed = hashToken(ctx.rawRefreshToken);
      const activeSession = await AuthSession.findOneAndUpdate(
        {
          userId,
          refreshTokenHash: hashed,
          isValid: true,
          expiresAt: { $gt: new Date() },
        },
        { isValid: false, rotatedAt: new Date() },
        { new: false }
      );
      if (activeSession) {
        familyId = activeSession.familyId;
        const nextRaw = generateRefreshToken();
        await AuthSession.create({
          userId,
          familyId,
          refreshTokenHash: hashToken(nextRaw),
          userAgent: ctx.userAgent || activeSession.userAgent || 'Unknown',
          ipAddress: ctx.ip || activeSession.ipAddress || 'Unknown',
          isValid: true,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        rotatedRefreshToken = nextRaw;
      }
    }

    return { familyId, rotatedRefreshToken };
  }

  async updateEmail(
    userId: string,
    input: UpdateEmailInput,
    ctx: CredentialMutationContext = {}
  ): Promise<CredentialMutationResult> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier format.', 'INVALID_IDENTIFIER');
    }

    return this.enqueueUserMutation(userId, async () => {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
      }

      if (user.hasLocalPassword === false) {
        throw new AppError(
          'Please set a local password before changing your email so you retain account recovery access.',
          403,
          'LOCAL_PASSWORD_REQUIRED'
        );
      }

      if (!input.currentPassword) {
        throw new UnauthorizedError('Current password is required to change email.', 'INVALID_CREDENTIALS');
      }

      const validPassword = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!validPassword) {
        throw new UnauthorizedError('Current password is incorrect.', 'INVALID_CREDENTIALS');
      }

      const normalizedEmail = input.email.toLowerCase().trim();
      if (normalizedEmail === user.email.toLowerCase().trim()) {
        throw new BadRequestError('New email matches your current email address.', 'SAME_EMAIL');
      }

      const existing = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: user._id },
      });
      if (existing) {
        throw new ConflictError('An account with this email address already exists.', 'EMAIL_ALREADY_EXISTS');
      }

      let updated: IUser | null = null;
      try {
        updated = await User.findByIdAndUpdate(
          userId,
          { $set: { email: normalizedEmail } },
          { new: true, runValidators: true }
        );
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000) {
          throw new ConflictError('An account with this email address already exists.', 'EMAIL_ALREADY_EXISTS');
        }
        throw err;
      }

      if (!updated) {
        throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
      }

      const { familyId, rotatedRefreshToken } = await this.resolveCallerFamilyAndRotate(updated._id, ctx);

      securityAudit.log({
        eventType: 'AUTH_EMAIL_UPDATED',
        userId: updated._id.toString(),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        details: { familyId },
      });

      const preferences = await this.resolveUserPreferences(updated);
      const accessToken = generateAccessToken({
        sub: updated._id.toString(),
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role || 'user',
        ...(familyId ? { familyId } : {}),
      });

      return {
        user: buildUserProfileResponse(updated, preferences),
        accessToken,
        rotatedRefreshToken,
      };
    });
  }

  async updatePassword(
    userId: string,
    input: UpdatePasswordInput,
    ctx: CredentialMutationContext = {}
  ): Promise<CredentialMutationResult> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier format.', 'INVALID_IDENTIFIER');
    }

    return this.enqueueUserMutation(userId, async () => {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
      }

      const hadLocalPassword = user.hasLocalPassword !== false;
      if (hadLocalPassword) {
        if (!input.currentPassword) {
          throw new UnauthorizedError('Current password is required.', 'INVALID_CREDENTIALS');
        }
        const validCurrent = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!validCurrent) {
          throw new UnauthorizedError('Current password is incorrect.', 'INVALID_CREDENTIALS');
        }
        if (input.newPassword === input.currentPassword) {
          throw new BadRequestError(
            'New password must differ from your current password.',
            'SAME_PASSWORD'
          );
        }
      }

      const nextPasswordHash = await hashPassword(input.newPassword);
      const updated = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            passwordHash: nextPasswordHash,
            hasLocalPassword: true,
          },
        },
        { new: true }
      );
      if (!updated) {
        throw new NotFoundError('User account not found.', 'USER_NOT_FOUND');
      }

      const { familyId, rotatedRefreshToken } = await this.resolveCallerFamilyAndRotate(updated._id, ctx);

      // Revoke sibling active sessions when caller session family is known
      if (familyId) {
        await AuthSession.updateMany(
          {
            userId: updated._id,
            familyId: { $ne: familyId },
            isValid: true,
          },
          { $set: { isValid: false, rotatedAt: new Date() } }
        );
      }

      securityAudit.log({
        eventType: 'AUTH_PASSWORD_UPDATED',
        userId: updated._id.toString(),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        details: {
          mode: hadLocalPassword ? 'rotated' : 'initial_set',
          siblingSessionsRevoked: Boolean(familyId),
        },
      });

      const preferences = await this.resolveUserPreferences(updated);
      const accessToken = generateAccessToken({
        sub: updated._id.toString(),
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role || 'user',
        ...(familyId ? { familyId } : {}),
      });

      return {
        user: buildUserProfileResponse(updated, preferences),
        accessToken,
        rotatedRefreshToken,
      };
    });
  }

  async getPreferences(userId: string): Promise<UserPreferencesResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier format.', 'INVALID_IDENTIFIER');
    }

    const pref = await UserPreferences.findOne({ userId });
    if (pref) {
      return {
        defaultAudioMuted: pref.defaultAudioMuted,
        defaultVideoOff: pref.defaultVideoOff,
        version: pref.version ?? 1,
        fieldVersions: {
          defaultAudioMuted: pref.fieldVersions?.defaultAudioMuted ?? 0,
          defaultVideoOff: pref.fieldVersions?.defaultVideoOff ?? 0,
        },
        updatedAt: pref.updatedAt,
      };
    }

    // Read-only fallback to legacy embedded User.preferences or system defaults
    const user = await User.findById(userId);
    return {
      defaultAudioMuted: user?.preferences?.defaultAudioMuted ?? true,
      defaultVideoOff: user?.preferences?.defaultVideoOff ?? false,
      version: 0,
      fieldVersions: {
        defaultAudioMuted: 0,
        defaultVideoOff: 0,
      },
      updatedAt: user?.updatedAt || new Date(),
    };
  }

  /**
   * Idempotently ensures a baseline UserPreferences document exists for `userId`
   * using an atomic `$setOnInsert` upsert seeded from legacy `users.preferences`
   * (or defaults). Concurrent inserts across multiple server instances resolve
   * cleanly via the unique index on `userId`.
   */
  private async ensureBaselinePreferencesDoc(userObjId: Types.ObjectId): Promise<void> {
    const existing = await UserPreferences.exists({ userId: userObjId });
    if (existing) return;

    const legacyUser = await User.findById(userObjId).select('preferences');
    const initialAudio = legacyUser?.preferences?.defaultAudioMuted ?? true;
    const initialVideo = legacyUser?.preferences?.defaultVideoOff ?? false;
    const now = new Date();

    try {
      await UserPreferences.collection.updateOne(
        { userId: userObjId },
        {
          $setOnInsert: {
            userId: userObjId,
            defaultAudioMuted: initialAudio,
            defaultVideoOff: initialVideo,
            version: 0,
            fieldVersions: {
              defaultAudioMuted: 0,
              defaultVideoOff: 0,
            },
            fieldTimestamps: {
              defaultAudioMuted: 0,
              defaultVideoOff: 0,
            },
            fieldMeta: {
              defaultAudioMuted: {
                clientSessionId: '',
                serverUpdatedAt: new Date(0),
                lastWriteId: '',
              },
              defaultVideoOff: {
                clientSessionId: '',
                serverUpdatedAt: new Date(0),
                lastWriteId: '',
              },
            },
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    } catch (err: any) {
      // Benign race: another server instance inserted the baseline document concurrently
      if (err?.code !== 11000) {
        throw err;
      }
    }
  }

  /**
   * Atomically updates user preferences using server-controlled per-field versions
   * (`fieldVersions`), document-level optimistic concurrency (`expectedVersion`),
   * and strict same-session monotonic timestamp ordering inside a SINGLE MongoDB
   * aggregation-pipeline `findOneAndUpdate`.
   *
   * Ordering & Safety Guarantees (zero client-session trust bypass, zero timed expiry):
   * 1. Cross-session / cross-device / post-reload writes MUST match the server-controlled
   *    `expectedVersion` or `expectedFieldVersions.<field>`. A differing `clientSessionId`
   *    alone NEVER authorizes overwriting another session's committed preference — delayed
   *    requests from previous sessions are explicitly rejected with HTTP 409
   *    `PREFERENCES_VERSION_CONFLICT`.
   * 2. Same-session rapid updates (`incomingSessionId === storedSessionId`) enforce
   *    strict monotonic `clientTimestamp >= storedTimestamp` indefinitely (no timed
   *    expiry window), silently ignoring late-arriving older packets (`staleIgnored: true`)
   *    without ever overwriting newer same-session commits.
   * 3. Independent fields (`defaultAudioMuted` vs `defaultVideoOff`) maintain independent
   *    `fieldVersions`, `fieldTimestamps`, and `fieldMeta`, allowing two devices to edit
   *    different fields concurrently without conflicting or clobbering each other.
   * 4. All-or-nothing conflict semantics: if ANY requested field hits a version/session
   *    conflict, MongoDB mutates ZERO fields and the server returns HTTP 409 so the caller
   *    can read fresh server state and retry safely.
   */
  async updatePreferences(
    userId: string,
    input: UpdatePreferencesInput,
    options: UpdatePreferencesExecutionOptions = {}
  ): Promise<UserPreferencesResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user identifier format.', 'INVALID_IDENTIFIER');
    }

    const serverNowMs = options.nowMs ?? Date.now();
    const serverNowDate = new Date(serverNowMs);
    const incomingTs = input.clientTimestamp;

    // Timestamp safety guard: reject timestamps significantly ahead of server UTC time
    // so a malicious or badly skewed future clock can never poison MongoDB ordering.
    if (incomingTs !== undefined) {
      if (!Number.isFinite(incomingTs) || incomingTs < 0) {
        throw new BadRequestError(
          'clientTimestamp must be a finite non-negative integer.',
          'INVALID_CLIENT_TIMESTAMP'
        );
      }
      if (incomingTs > serverNowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
        throw new BadRequestError(
          `clientTimestamp is too far in the future (exceeds ${MAX_FUTURE_CLOCK_SKEW_MS}ms server clock skew limit).`,
          'INVALID_CLIENT_TIMESTAMP'
        );
      }
    }

    const userObjId = new Types.ObjectId(userId);
    const incomingSessionId = input.clientSessionId ?? '';
    const hasAudio = typeof input.defaultAudioMuted === 'boolean';
    const hasVideo = typeof input.defaultVideoOff === 'boolean';
    const expectedAudioVer = input.expectedFieldVersions?.defaultAudioMuted;
    const expectedVideoVer = input.expectedFieldVersions?.defaultVideoOff;
    const writeId = crypto.randomUUID();

    // Only seed a baseline (version=0, fieldVersions={0,0}) document if the caller is
    // not asserting a positive expected version on a potentially missing record.
    const expectsPositiveFieldVersion =
      (expectedAudioVer !== undefined && expectedAudioVer > 0) ||
      (expectedVideoVer !== undefined && expectedVideoVer > 0);
    const shouldSeedBaseline =
      input.expectedVersion === undefined && !expectsPositiveFieldVersion;

    return this.enqueueUserMutation(userId, async () => {
      if (shouldSeedBaseline) {
        await this.ensureBaselinePreferencesDoc(userObjId);
      }

      if (options.beforeAtomicWrite) {
        await options.beforeAtomicWrite();
      }

      const buildFieldConflictExpr = (
        field: 'defaultAudioMuted' | 'defaultVideoOff',
        hasFieldInput: boolean,
        expectedFieldVer: number | undefined
      ): Record<string, any> => {
        if (!hasFieldInput) {
          return { $literal: false };
        }
        // Document-level expectedVersion is enforced directly in MongoDB's filter.
        if (input.expectedVersion !== undefined) {
          return { $literal: false };
        }

        const storedFieldVerExpr = { $ifNull: [`$fieldVersions.${field}`, 0] };
        const storedSessionExpr = { $ifNull: [`$fieldMeta.${field}.clientSessionId`, ''] };

        const isSameExplicitSession = {
          $and: [
            { $ne: [incomingSessionId, ''] },
            { $eq: [incomingSessionId, storedSessionExpr] },
          ],
        };

        if (expectedFieldVer !== undefined) {
          // Conflict unless:
          // (A) Exact server-controlled per-field version match (works across reloads,
          //     restarts, and skewed-clock devices after a fresh GET), OR
          // (B) Uncontested same-session rapid continuation where the SAME session still
          //     owns the field and expectedFieldVer <= storedFieldVer.
          const exactVersionMatch = { $eq: [storedFieldVerExpr, expectedFieldVer] };
          const sameSessionContinuation = {
            $and: [isSameExplicitSession, { $lte: [expectedFieldVer, storedFieldVerExpr] }],
          };
          return { $not: [{ $or: [exactVersionMatch, sameSessionContinuation] }] };
        }

        // Caller omitted both expectedVersion and expectedFieldVersions[field]:
        // NEVER permit a different session to silently overwrite a field already owned
        // by another session — require an explicit versioned retry (HTTP 409).
        return {
          $and: [
            { $ne: [storedSessionExpr, ''] },
            { $ne: [incomingSessionId, storedSessionExpr] },
          ],
        };
      };

      const buildFieldApplyExpr = (
        field: 'defaultAudioMuted' | 'defaultVideoOff',
        hasFieldInput: boolean,
        expectedFieldVer: number | undefined
      ): Record<string, any> => {
        if (!hasFieldInput) {
          return { $literal: false };
        }

        const noConflict = { $not: ['$_hasConflict'] };

        // Document-level expectedVersion already matched atomically in MongoDB filter
        if (input.expectedVersion !== undefined) {
          return noConflict;
        }

        const storedFieldVerExpr = { $ifNull: [`$fieldVersions.${field}`, 0] };
        const storedTsExpr = { $ifNull: [`$fieldTimestamps.${field}`, 0] };
        const storedSessionExpr = { $ifNull: [`$fieldMeta.${field}.clientSessionId`, ''] };

        const tsNotOlder =
          incomingTs === undefined
            ? { $literal: true }
            : { $gte: [incomingTs, storedTsExpr] };

        if (expectedFieldVer !== undefined) {
          // Condition A: Exact per-field version match (server-authoritative — immune to
          // cross-device clock skew, browser reloads, and restarts).
          const exactVersionMatch = { $eq: [storedFieldVerExpr, expectedFieldVer] };

          // Condition B: Same-session rapid continuation (enforces strict monotonic
          // clientTimestamp >= storedTs indefinitely; zero timed expiry).
          const sameSessionNewer = {
            $and: [
              { $ne: [incomingSessionId, ''] },
              { $eq: [incomingSessionId, storedSessionExpr] },
              { $lte: [expectedFieldVer, storedFieldVerExpr] },
              tsNotOlder,
            ],
          };

          return {
            $and: [noConflict, { $or: [exactVersionMatch, sameSessionNewer] }],
          };
        }

        // Same-session (or initial unclaimed field) without explicit version:
        // Enforce strict monotonic clientTimestamp >= storedTs indefinitely.
        return {
          $and: [noConflict, tsNotOlder],
        };
      };

      const filter: Record<string, any> = { userId: userObjId };
      if (input.expectedVersion !== undefined) {
        filter.version = input.expectedVersion;
      }

      // Single atomic MongoDB aggregation-pipeline update:
      // Stage 1: Evaluate all per-field conflict predicates atomically.
      // Stage 2: Evaluate all-or-nothing _hasConflict and per-field _apply flags.
      // Stage 3: Mutate ONLY eligible fields, bump per-field fieldVersions & doc version.
      // Stage 4: Clean up temporary pipeline variables.
      const atomicPipeline: Record<string, any>[] = [
        {
          $set: {
            _conflictAudio: buildFieldConflictExpr('defaultAudioMuted', hasAudio, expectedAudioVer),
            _conflictVideo: buildFieldConflictExpr('defaultVideoOff', hasVideo, expectedVideoVer),
          },
        },
        {
          $set: {
            _hasConflict: { $or: ['$_conflictAudio', '$_conflictVideo'] },
          },
        },
        {
          $set: {
            _applyAudio: buildFieldApplyExpr('defaultAudioMuted', hasAudio, expectedAudioVer),
            _applyVideo: buildFieldApplyExpr('defaultVideoOff', hasVideo, expectedVideoVer),
          },
        },
        {
          $set: {
            defaultAudioMuted: {
              $cond: [
                '$_applyAudio',
                hasAudio ? input.defaultAudioMuted : true,
                { $ifNull: ['$defaultAudioMuted', true] },
              ],
            },
            defaultVideoOff: {
              $cond: [
                '$_applyVideo',
                hasVideo ? input.defaultVideoOff : false,
                { $ifNull: ['$defaultVideoOff', false] },
              ],
            },
            fieldVersions: {
              defaultAudioMuted: {
                $cond: [
                  '$_applyAudio',
                  { $add: [{ $ifNull: ['$fieldVersions.defaultAudioMuted', 0] }, 1] },
                  { $ifNull: ['$fieldVersions.defaultAudioMuted', 0] },
                ],
              },
              defaultVideoOff: {
                $cond: [
                  '$_applyVideo',
                  { $add: [{ $ifNull: ['$fieldVersions.defaultVideoOff', 0] }, 1] },
                  { $ifNull: ['$fieldVersions.defaultVideoOff', 0] },
                ],
              },
            },
            fieldTimestamps: {
              defaultAudioMuted: {
                $cond: [
                  '$_applyAudio',
                  incomingTs !== undefined
                    ? incomingTs
                    : { $ifNull: ['$fieldTimestamps.defaultAudioMuted', 0] },
                  { $ifNull: ['$fieldTimestamps.defaultAudioMuted', 0] },
                ],
              },
              defaultVideoOff: {
                $cond: [
                  '$_applyVideo',
                  incomingTs !== undefined
                    ? incomingTs
                    : { $ifNull: ['$fieldTimestamps.defaultVideoOff', 0] },
                  { $ifNull: ['$fieldTimestamps.defaultVideoOff', 0] },
                ],
              },
            },
            fieldMeta: {
              defaultAudioMuted: {
                $cond: [
                  '$_applyAudio',
                  {
                    clientSessionId: incomingSessionId,
                    serverUpdatedAt: serverNowDate,
                    lastWriteId: writeId,
                  },
                  {
                    clientSessionId: {
                      $ifNull: ['$fieldMeta.defaultAudioMuted.clientSessionId', ''],
                    },
                    serverUpdatedAt: {
                      $ifNull: ['$fieldMeta.defaultAudioMuted.serverUpdatedAt', new Date(0)],
                    },
                    lastWriteId: {
                      $ifNull: ['$fieldMeta.defaultAudioMuted.lastWriteId', ''],
                    },
                  },
                ],
              },
              defaultVideoOff: {
                $cond: [
                  '$_applyVideo',
                  {
                    clientSessionId: incomingSessionId,
                    serverUpdatedAt: serverNowDate,
                    lastWriteId: writeId,
                  },
                  {
                    clientSessionId: {
                      $ifNull: ['$fieldMeta.defaultVideoOff.clientSessionId', ''],
                    },
                    serverUpdatedAt: {
                      $ifNull: ['$fieldMeta.defaultVideoOff.serverUpdatedAt', new Date(0)],
                    },
                    lastWriteId: {
                      $ifNull: ['$fieldMeta.defaultVideoOff.lastWriteId', ''],
                    },
                  },
                ],
              },
            },
            version: {
              $cond: [
                { $or: ['$_applyAudio', '$_applyVideo'] },
                { $add: [{ $ifNull: ['$version', 0] }, 1] },
                { $ifNull: ['$version', 1] },
              ],
            },
            updatedAt: {
              $cond: [
                { $or: ['$_applyAudio', '$_applyVideo'] },
                serverNowDate,
                { $ifNull: ['$updatedAt', serverNowDate] },
              ],
            },
          },
        },
        {
          $unset: [
            '_conflictAudio',
            '_conflictVideo',
            '_hasConflict',
            '_applyAudio',
            '_applyVideo',
          ],
        },
      ];

      const updatedDoc = (await UserPreferences.collection.findOneAndUpdate(
        filter,
        atomicPipeline,
        { returnDocument: 'after' }
      )) as unknown as IUserPreferencesDoc | null;

      if (!updatedDoc) {
        if (input.expectedVersion !== undefined || expectsPositiveFieldVersion) {
          const current = await UserPreferences.findOne({ userId: userObjId }).select(
            'version fieldVersions'
          );
          const currentVersion = current?.version ?? 0;
          throw new ConflictError(
            `Preference version conflict: expected version ${input.expectedVersion ?? JSON.stringify(input.expectedFieldVersions)}, current version is ${currentVersion}. Please refresh and retry.`,
            'PREFERENCES_VERSION_CONFLICT'
          );
        }
        throw new NotFoundError('Preferences record could not be saved.', 'PREFERENCES_SAVE_FAILED');
      }

      const audioApplied =
        !hasAudio || updatedDoc.fieldMeta?.defaultAudioMuted?.lastWriteId === writeId;
      const videoApplied =
        !hasVideo || updatedDoc.fieldMeta?.defaultVideoOff?.lastWriteId === writeId;

      // Determine whether an unapplied write was an explicit cross-session/version conflict
      // (HTTP 409) vs. a same-session out-of-order stale packet (HTTP 200 staleIgnored: true).
      const detectFieldConflict = (
        field: 'defaultAudioMuted' | 'defaultVideoOff',
        hasFieldInput: boolean,
        applied: boolean,
        expectedFieldVer: number | undefined
      ): boolean => {
        if (!hasFieldInput || applied) return false;
        const storedSession = updatedDoc.fieldMeta?.[field]?.clientSessionId ?? '';
        const storedFieldVer = updatedDoc.fieldVersions?.[field] ?? 0;

        if (expectedFieldVer !== undefined) {
          const sameExplicitSession =
            incomingSessionId !== '' && incomingSessionId === storedSession;
          // If another session owns it, or caller's expected version wasn't <= stored, it's a 409 conflict
          if (!sameExplicitSession || expectedFieldVer > storedFieldVer) {
            return true;
          }
          return false;
        }

        // Unversioned cross-session write on a field owned by another session -> 409 conflict
        if (storedSession !== '' && incomingSessionId !== storedSession) {
          return true;
        }
        return false;
      };

      const audioConflicted = detectFieldConflict(
        'defaultAudioMuted',
        hasAudio,
        audioApplied,
        expectedAudioVer
      );
      const videoConflicted = detectFieldConflict(
        'defaultVideoOff',
        hasVideo,
        videoApplied,
        expectedVideoVer
      );

      if (audioConflicted || videoConflicted) {
        throw new ConflictError(
          `Preference version conflict: a newer session modified preferences (current version: ${updatedDoc.version}, fieldVersions: ${JSON.stringify(updatedDoc.fieldVersions)}). Please refresh and retry.`,
          'PREFERENCES_VERSION_CONFLICT'
        );
      }

      const staleIgnored = !audioApplied || !videoApplied;

      // Mirror committed authoritative values to legacy embedded User.preferences ONLY
      // if our committed version is >= the already-mirrored preferencesVersion.
      // This guarantees out-of-order mirror writes across multiple server instances
      // can NEVER replace newer values with stale mirrored data.
      if (audioApplied || videoApplied) {
        if (options.beforeLegacyMirror) {
          await options.beforeLegacyMirror();
        }
        await User.updateOne(
          {
            _id: userObjId,
            $or: [
              { preferencesVersion: { $exists: false } },
              { preferencesVersion: { $lte: updatedDoc.version } },
            ],
          },
          {
            $set: {
              'preferences.defaultAudioMuted': updatedDoc.defaultAudioMuted,
              'preferences.defaultVideoOff': updatedDoc.defaultVideoOff,
              preferencesVersion: updatedDoc.version,
            },
          }
        );
      }

      return {
        defaultAudioMuted: updatedDoc.defaultAudioMuted,
        defaultVideoOff: updatedDoc.defaultVideoOff,
        version: updatedDoc.version ?? 1,
        fieldVersions: {
          defaultAudioMuted: updatedDoc.fieldVersions?.defaultAudioMuted ?? 0,
          defaultVideoOff: updatedDoc.fieldVersions?.defaultVideoOff ?? 0,
        },
        ...(staleIgnored ? { staleIgnored: true } : {}),
        updatedAt: updatedDoc.updatedAt,
      };
    });
  }
}

export const userService = new UserService();
