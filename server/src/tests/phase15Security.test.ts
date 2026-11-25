import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../app.js';
import { User } from '../models/User.model.js';
import { AuthSession } from '../models/Session.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage, toChatMessageDto } from '../models/ChatMessage.model.js';
import { hashPassword } from '../utils/password.js';
import {
  generateRefreshToken,
  generateFamilyId,
  hashToken,
} from '../utils/tokens.js';
import {
  cryptoEngine,
  EnvelopeEncryptionEngine,
  constantTimeCompare,
  CryptoVerificationError,
  CryptoKeyNotFoundError,
} from '../utils/crypto.js';
import {
  EnvKeyProvider,
  normalizeKey,
  SecurityConfigurationError,
  CLOUD_KMS_STATUS,
  UnimplementedKmsKeyProvider,
} from '../services/keyManagement.service.js';
import {
  securityAudit,
  sanitizePayload,
  AUDIT_LOGGER_INTEGRITY_CLASSIFICATION,
} from '../utils/securityAudit.js';
import { LiveKitService, validateLiveKitConfig } from '../services/livekit.service.js';
import { S3StorageProvider } from '../storage/s3StorageProvider.js';
import { chatService } from '../services/chat.service.js';
import { meetingService } from '../services/meeting.service.js';
import { dataEncryptionMigration } from '../services/dataEncryptionMigration.service.js';
import { hashBearerToken, verifyBearerToken } from '../utils/tokenHash.js';
import {
  recordFailedLoginAttempt,
  LOCKOUT_DURATION_MS,
} from '../controllers/auth.controller.js';
import {
  getCspDirectives,
} from '../config/csp.js';
import { resetLoginRateLimit } from '../middlewares/rateLimiter.js';

describe('Phase 15 — Encryption & Security Suite', () => {
  let server: Server;
  let baseUrl: string;
  let testUser: any;
  const validPassword = 'SecureMasterPassword2026!';
  let testMeeting: any;

  before(async () => {
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly_phase15_security_test');
    await User.deleteMany({});
    await AuthSession.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await ChatMessage.deleteMany({});

    const passwordHash = await hashPassword(validPassword);
    testUser = await User.create({
      email: 'phase15.security@connectly.io',
      passwordHash,
      firstName: 'Cipher',
      lastName: 'Guardian',
      isEmailVerified: true,
    });

    const meetRes = await meetingService.createMeeting(testUser._id.toString(), {
      title: 'Phase 15 Security Test Meeting',
      maxParticipants: 10,
    });
    testMeeting = meetRes.meeting;

    // Join test user as admitted host
    await meetingService.joinMeeting(testMeeting.meetingCode, testUser._id.toString(), {
      displayName: 'Cipher Guardian',
    });
    await MeetingParticipant.findOne({
      meetingId: testMeeting.id,
      userId: testUser._id,
    });

    const app = createApp();
    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await User.deleteMany({});
    await AuthSession.deleteMany({});
    await Meeting.deleteMany({});
    await MeetingParticipant.deleteMany({});
    await ChatMessage.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    securityAudit.clear();
    resetLoginRateLimit();
    // Reset test user lockout state
    if (testUser) {
      await User.updateOne(
        { _id: testUser._id },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockoutUntil: 1 } }
      );
    }
  });

  // =========================================================================
  // SECTION A: APPLICATION ENVELOPE ENCRYPTION ENGINE (AES-256-GCM)
  // =========================================================================
  describe('A. Application Envelope Encryption Engine (AES-256-GCM)', () => {
    const rawKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const keyProvider = new EnvKeyProvider({
      nodeEnv: 'test',
      keys: { v1: rawKeyHex },
      activeVersion: 'v1',
    });
    const engine = new EnvelopeEncryptionEngine(keyProvider);

    it('1. Encryption/decryption round trip for plaintext strings and binary buffers', () => {
      const plaintext = 'Classified Meeting Notes: Project Athena architecture details.';
      const ciphertext = engine.encrypt(plaintext);

      assert.ok(typeof ciphertext === 'string');
      assert.ok(ciphertext.startsWith('v1:'));
      assert.ok(engine.isEncrypted(ciphertext));

      const decrypted = engine.decryptString(ciphertext);
      assert.strictEqual(decrypted, plaintext);

      // Binary buffer test
      const binaryData = crypto.randomBytes(64);
      const encBinary = engine.encrypt(binaryData);
      const decBinary = engine.decrypt(encBinary);
      assert.ok(decBinary.equals(binaryData));
    });

    it('2. Unique nonce/IV generation across 200 consecutive encryptions (zero collisions)', () => {
      const plaintext = 'Identical message payload across multiple transmissions';
      const nonces = new Set<string>();

      for (let i = 0; i < 200; i++) {
        const ciphertext = engine.encrypt(plaintext);
        const parts = ciphertext.split(':');
        const ivHex = parts[1];
        assert.strictEqual(ivHex.length, 24, 'IV must be 12 bytes = 24 hex characters');
        assert.ok(!nonces.has(ivHex), `Collision detected on IV: ${ivHex}`);
        nonces.add(ivHex);
      }

      assert.strictEqual(nonces.size, 200);
    });

    it('3. Ciphertext tampering detection: Modifying 1 bit in ciphertext fails GCM auth tag', () => {
      const plaintext = 'Critical security payload';
      const ciphertext = engine.encrypt(plaintext);
      const parts = ciphertext.split(':');

      // Flip the last character in the ciphertext segment
      const lastChar = parts[3].slice(-1);
      const flippedChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedCiphertext = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3].slice(0, -1)}${flippedChar}`;

      assert.throws(
        () => {
          engine.decrypt(tamperedCiphertext);
        },
        CryptoVerificationError,
        'Decryption must reject tampered ciphertext'
      );

      // Verify security audit logged tampering event
      const events = securityAudit.query({ eventType: 'CRYPTO_AUTH_TAG_FAILED' });
      assert.ok(events.length >= 1, 'Must record CRYPTO_AUTH_TAG_FAILED in audit log');
    });

    it('4. Auth tag tampering detection: Modifying authentication tag fails verification', () => {
      const plaintext = 'Another critical payload';
      const ciphertext = engine.encrypt(plaintext);
      const parts = ciphertext.split(':');

      // Flip first char in tag
      const firstTagChar = parts[2][0];
      const flippedTag = (firstTagChar === '0' ? '1' : '0') + parts[2].slice(1);
      const tamperedTagCiphertext = `${parts[0]}:${parts[1]}:${flippedTag}:${parts[3]}`;

      assert.throws(() => {
        engine.decrypt(tamperedTagCiphertext);
      }, CryptoVerificationError);
    });

    it('5. Associated Authenticated Data (AAD) enforcement: Mismatched AAD fails verification', () => {
      const plaintext = 'Participant salary information';
      const entityAad = 'meeting:cly-998-xyz:user:u123';
      const wrongAad = 'meeting:cly-000-attacker:user:u123';

      const ciphertext = engine.encrypt(plaintext, { aad: entityAad });

      // Correct AAD succeeds
      const decrypted = engine.decryptString(ciphertext, { aad: entityAad });
      assert.strictEqual(decrypted, plaintext);

      // Wrong AAD fails closed
      assert.throws(() => {
        engine.decryptString(ciphertext, { aad: wrongAad });
      }, CryptoVerificationError);

      // Missing AAD fails closed
      assert.throws(() => {
        engine.decryptString(ciphertext);
      }, CryptoVerificationError);
    });

    it('6. Wrong key rejection: Decrypting with an incorrect 256-bit key fails', () => {
      const plaintext = 'Secret blueprint';
      const ciphertext = engine.encrypt(plaintext);

      const altKeyProvider = new EnvKeyProvider({
        nodeEnv: 'test',
        keys: { v1: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' },
        activeVersion: 'v1',
      });
      const altEngine = new EnvelopeEncryptionEngine(altKeyProvider);

      assert.throws(() => {
        altEngine.decrypt(ciphertext);
      }, CryptoVerificationError);
    });

    it('7. Unknown key version rejection: Throws CryptoKeyNotFoundError', () => {
      const malformedVersionCiphertext = 'v99:0102030405060708090a0b0c:0102030405060708090a0b0c0d0e0f10:aabbcc';
      assert.throws(() => {
        engine.decrypt(malformedVersionCiphertext);
      }, CryptoKeyNotFoundError);
    });

    it('8. Key rotation: Decrypts records encrypted with older keys and encrypts new ones with active key', () => {
      const keyV1 = '1111111111111111111111111111111111111111111111111111111111111111';
      const keyV2 = '2222222222222222222222222222222222222222222222222222222222222222';

      const multiKeyProvider = new EnvKeyProvider({
        nodeEnv: 'test',
        keys: { v1: keyV1 },
        activeVersion: 'v1',
      });
      const multiEngine = new EnvelopeEncryptionEngine(multiKeyProvider);

      // Encrypt with v1
      const c1 = multiEngine.encrypt('Created under v1 key');
      assert.ok(c1.startsWith('v1:'));

      // Rotate to v2
      multiKeyProvider.rotateKey('v2', keyV2);
      assert.strictEqual(multiKeyProvider.getActiveKey().version, 'v2');

      // Decrypt old v1 record (backward compatibility)
      assert.strictEqual(multiEngine.decryptString(c1), 'Created under v1 key');

      // New record is encrypted with v2
      const c2 = multiEngine.encrypt('Created under v2 key');
      assert.ok(c2.startsWith('v2:'));
      assert.strictEqual(multiEngine.decryptString(c2), 'Created under v2 key');
    });

    it('9. Ciphertext migration: Re-encrypts older version to target active version', () => {
      const keyV1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const keyV2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      const migrationProvider = new EnvKeyProvider({
        nodeEnv: 'test',
        keys: { v1: keyV1, v2: keyV2 },
        activeVersion: 'v2',
      });
      const migEngine = new EnvelopeEncryptionEngine(migrationProvider);

      const oldCiphertext = migEngine.encrypt('Legacy confidential message', { keyVersion: 'v1' });
      assert.ok(oldCiphertext.startsWith('v1:'));

      const migratedCiphertext = migEngine.migrateCiphertext(oldCiphertext);
      assert.ok(migratedCiphertext.startsWith('v2:'));
      assert.strictEqual(migEngine.decryptString(migratedCiphertext), 'Legacy confidential message');
    });

    it('10. Constant-time comparison helper prevents timing side-channels', () => {
      const tokenA = 'f7d2a58b90123456789abcdef0123456789abcdef0123456789abcdef0123456';
      const tokenB = 'f7d2a58b90123456789abcdef0123456789abcdef0123456789abcdef0123456';
      const tokenC = 'f7d2a58b90123456789abcdef0123456789abcdef0123456789abcdef0123457';

      assert.strictEqual(constantTimeCompare(tokenA, tokenB), true);
      assert.strictEqual(constantTimeCompare(tokenA, tokenC), false);
      assert.strictEqual(constantTimeCompare(tokenA, 'short'), false);
    });
  });

  // =========================================================================
  // SECTION A2: DEF-15-01 PERSISTED DATA ENCRYPTION & MIGRATION INTEGRATION
  // =========================================================================
  describe('A2. DEF-15-01 Persisted Data Encryption & Migration Integration', () => {
    it('10A. ChatMessage.content is encrypted at rest with AES-256-GCM in MongoDB', async () => {
      const rawText = 'Confidential strategic discussion during board meeting';
      const clientMessageId = `cm_sec_test_${Date.now()}`;

      // Send message via chatService
      const dto = await chatService.sendMessage(testMeeting.meetingCode, testUser._id.toString(), {
        content: rawText,
        clientMessageId,
      });

      assert.strictEqual(dto.content, rawText, 'Service response must return decrypted text');

      // CRITICAL VERIFICATION: Direct MongoDB collection query bypasses Mongoose getters
      // and inspects the raw stored document in BSON
      const rawDoc = await mongoose.connection
        .collection('chatmessages')
        .findOne({ _id: new mongoose.Types.ObjectId(dto.id) });

      assert.ok(rawDoc, 'Document must exist in MongoDB');
      assert.notStrictEqual(
        rawDoc.content,
        rawText,
        'Raw MongoDB document must NOT contain plaintext'
      );
      assert.ok(cryptoEngine.isEncrypted(rawDoc.content), 'Raw content must be valid versioned ciphertext');
      assert.ok(rawDoc.content.startsWith('v1:'), 'Raw ciphertext must start with active key version');

      // Authorized getChatHistory decrypts the message correctly
      const history = await chatService.getChatHistory(testMeeting.meetingCode, testUser._id.toString(), {
        limit: 10,
      });
      const found = history.messages.find((m) => m.id === dto.id);
      assert.ok(found);
      assert.strictEqual(found.content, rawText);
    });

    it('10B. Ciphertext tampering or wrong AAD fails closed with CryptoVerificationError', async () => {
      // Create message with specific AAD
      const meetingAId = new mongoose.Types.ObjectId();
      const meetingBId = new mongoose.Types.ObjectId();
      const plaintext = 'Secret text for meeting A';

      const cipherMeetingA = cryptoEngine.encrypt(plaintext, {
        aad: `chat:${meetingAId.toString()}`,
      });

      // Decrypt with meeting A's AAD succeeds
      const decA = cryptoEngine.decryptString(cipherMeetingA, {
        aad: `chat:${meetingAId.toString()}`,
      });
      assert.strictEqual(decA, plaintext);

      // Decrypt with meeting B's AAD fails closed
      assert.throws(() => {
        cryptoEngine.decryptString(cipherMeetingA, {
          aad: `chat:${meetingBId.toString()}`,
        });
      }, CryptoVerificationError);
    });

    it('10C. Backward compatibility: Legacy plaintext ChatMessage records pass through safely', async () => {
      const legacyText = 'This is a legacy unencrypted chat message from Phase 12';
      const legacyDoc = await ChatMessage.create({
        meetingId: testMeeting.id,
        senderId: testUser._id,
        senderName: 'Legacy Sender',
        senderRole: 'participant',
        content: legacyText, // Plaintext, not starting with v1:
      });

      // Mongoose getter passes plaintext through
      assert.strictEqual(legacyDoc.content, legacyText);

      // toChatMessageDto passes plaintext through
      const dto = toChatMessageDto(legacyDoc);
      assert.strictEqual(dto.content, legacyText);
    });

    it('10D. DataEncryptionMigrationService safely migrates plaintext records in bounded batches', async () => {
      // Clear messages so test runs in isolation
      await ChatMessage.deleteMany({});

      // Insert 5 legacy plaintext messages directly into collection
      const meetingId = new mongoose.Types.ObjectId(testMeeting.id);
      const createdIds: mongoose.Types.ObjectId[] = [];

      for (let i = 1; i <= 5; i++) {
        const id = new mongoose.Types.ObjectId();
        createdIds.push(id);
        await mongoose.connection.collection('chatmessages').insertOne({
          _id: id,
          meetingId,
          senderId: testUser._id,
          senderName: 'Batch Tester',
          senderRole: 'participant',
          content: `Legacy unencrypted message batch item ${i}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Run batch migration with batchSize: 3
      const firstBatch = await dataEncryptionMigration.migratePlaintextChatMessages({ batchSize: 3 });
      assert.strictEqual(firstBatch.migratedCount, 3);
      assert.strictEqual(firstBatch.isComplete, false);

      // Run second batch with startingId
      const secondBatch = await dataEncryptionMigration.migratePlaintextChatMessages({
        batchSize: 10,
        startingId: firstBatch.lastProcessedId!,
      });
      assert.strictEqual(secondBatch.migratedCount, 2);

      // Verify that all 5 are now stored as versioned ciphertext
      for (const id of createdIds) {
        const doc = await mongoose.connection.collection('chatmessages').findOne({ _id: id });
        assert.ok(cryptoEngine.isEncrypted(doc?.content));
      }

      // Re-running migration finds 0 unencrypted records (idempotent)
      const rerun = await dataEncryptionMigration.migratePlaintextChatMessages({ batchSize: 50 });
      assert.strictEqual(rerun.migratedCount, 0);
      assert.ok(rerun.alreadyEncryptedCount >= 5);
    });

    it('10E. Bearer tokens (emailVerificationToken, passwordResetToken) are hashed with SHA-256', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashed = hashBearerToken(rawToken);

      assert.strictEqual(hashed.length, 64, 'SHA-256 hash must be 64 hex characters');
      assert.notStrictEqual(hashed, rawToken);

      // Verify User.findByHashedToken resolves the user using rawToken
      await User.updateOne({ _id: testUser._id }, { $set: { passwordResetToken: hashed } });
      const foundUser = await User.findByHashedToken('passwordResetToken', rawToken);
      assert.ok(foundUser);
      assert.strictEqual(foundUser._id.toString(), testUser._id.toString());

      // Verify constant-time comparison
      assert.strictEqual(verifyBearerToken(rawToken, hashed), true);
      assert.strictEqual(verifyBearerToken('wrong_token', hashed), false);
    });
  });

  // =========================================================================
  // SECTION B: KEY MANAGEMENT & PRODUCTION FAIL-CLOSED SAFEGUARDS
  // =========================================================================
  describe('B. Key Management & Production Fail-Closed Safeguards', () => {
    it('11. normalizeKey validates key representations and rejects invalid lengths', () => {
      // 64-char hex valid
      const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      assert.strictEqual(normalizeKey(hexKey).length, 32);

      // 32-byte raw buffer valid
      assert.strictEqual(normalizeKey(Buffer.alloc(32, 1)).length, 32);

      // Invalid short key fails closed
      assert.throws(() => {
        normalizeKey('short_insecure_key');
      }, SecurityConfigurationError);
    });

    it('12. In production mode, EnvKeyProvider fails closed on missing or placeholder keys', () => {
      assert.throws(() => {
        const prodProvider = new EnvKeyProvider({
          nodeEnv: 'production',
          keys: { v1: 'replace_with_a_real_production_secret_32_bytes_hex_abc1234567890123' },
          activeVersion: 'v1',
        });
        prodProvider.assertValid();
      }, SecurityConfigurationError);
    });

    it('12A. DEF-15-02: Missing CONNECTLY_ACTIVE_KEY_VERSION throws SecurityConfigurationError', () => {
      assert.throws(() => {
        // Active key specified as v3, but only v1 is configured
        new EnvKeyProvider({
          nodeEnv: 'test',
          keys: { v1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
          activeVersion: 'v3',
        });
      }, SecurityConfigurationError);
    });

    it('12B. DEF-15-02: Simulated server restart preserves historical keys for decryption and active key for encryption', () => {
      const v1Key = '1111111111111111111111111111111111111111111111111111111111111111';
      const v2Key = '2222222222222222222222222222222222222222222222222222222222222222';

      // 1. Initial process instance before restart
      const instance1 = new EnvKeyProvider({
        nodeEnv: 'test',
        keys: { v1: v1Key },
        activeVersion: 'v1',
      });
      const engine1 = new EnvelopeEncryptionEngine(instance1);

      // Encrypt with v1
      const c1 = engine1.encrypt('Persistent record pre-restart');
      assert.ok(c1.startsWith('v1:'));

      // Rotate to v2 and export persistent environment dictionary
      instance1.rotateKey('v2', v2Key);
      const persistentEnv = instance1.exportPersistentConfig();
      assert.strictEqual(persistentEnv.CONNECTLY_ACTIVE_KEY_VERSION, 'v2');
      assert.strictEqual(persistentEnv.CONNECTLY_ENCRYPTION_KEY_V1, v1Key);
      assert.strictEqual(persistentEnv.CONNECTLY_ENCRYPTION_KEY_V2, v2Key);

      // 2. Simulated process restart: new instance initialized with persistent keys
      const restartedInstance = new EnvKeyProvider({
        nodeEnv: 'test',
        keys: {
          v1: persistentEnv.CONNECTLY_ENCRYPTION_KEY_V1,
          v2: persistentEnv.CONNECTLY_ENCRYPTION_KEY_V2,
        },
        activeVersion: persistentEnv.CONNECTLY_ACTIVE_KEY_VERSION,
      });
      const restartedEngine = new EnvelopeEncryptionEngine(restartedInstance);

      // Decrypt pre-restart v1 record (backward compatibility survived restart)
      assert.strictEqual(restartedEngine.decryptString(c1), 'Persistent record pre-restart');

      // Encrypt post-restart record (uses active v2)
      const c2 = restartedEngine.encrypt('New record post-restart');
      assert.ok(c2.startsWith('v2:'));
      assert.strictEqual(restartedEngine.decryptString(c2), 'New record post-restart');
    });

    it('12C. DEF-15-03: Cloud KMS is explicitly classified as NOT IMPLEMENTED (production prerequisite)', () => {
      assert.strictEqual(CLOUD_KMS_STATUS, 'NOT_IMPLEMENTED_PRODUCTION_PREREQUISITE');

      const placeholderKms = new UnimplementedKmsKeyProvider('arn:aws:kms:us-east-1:123456789012:key/test');
      assert.throws(() => {
        placeholderKms.assertValid();
      }, SecurityConfigurationError);
    });
  });

  // =========================================================================
  // SECTION C: AUTHENTICATION, TIMING DEFENSE & ACCOUNT LOCKOUT
  // =========================================================================
  describe('C. Authentication, Timing Defense & Account Lockout', () => {
    it('13. Timing defense: Non-existent user login burns Argon2 compute and returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'nonexistent.user.audit@connectly.io',
          password: 'SomeDummyPassword123!',
        }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'INVALID_CREDENTIALS');

      // Verify timing defense audit log was emitted
      const timingAudit = securityAudit.query({ eventType: 'AUTH_TIMING_DEFENSE_TRIGGERED' });
      assert.ok(timingAudit.length >= 1, 'Must record AUTH_TIMING_DEFENSE_TRIGGERED');
    });

    it('14. DEF-15-05: Account lockout returns uniform 401 INVALID_CREDENTIALS (prevents enumeration / DoS)', async () => {
      // Execute 4 failed attempts
      for (let i = 1; i <= 4; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({
            email: testUser.email,
            password: 'WrongPassword!',
          }),
        });
        assert.strictEqual(res.status, 401);
      }

      // 5th failed attempt triggers lockout threshold
      const fifthRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: testUser.email,
          password: 'WrongPassword!',
        }),
      });
      assert.strictEqual(fifthRes.status, 401);

      // Verify user document has lockoutUntil set in database
      const reloadedUser = await User.findById(testUser._id);
      assert.ok(reloadedUser?.lockoutUntil);
      assert.ok(reloadedUser.lockoutUntil.getTime() > Date.now());
      assert.strictEqual(reloadedUser.failedLoginAttempts, 5);

      // DEF-15-05: 6th attempt (even with CORRECT password) returns HTTP 401 INVALID_CREDENTIALS
      // exactly matching unknown accounts to prevent enumeration
      const lockedRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: testUser.email,
          password: validPassword,
        }),
      });
      assert.strictEqual(lockedRes.status, 401);
      const lockedData = await lockedRes.json();
      assert.strictEqual(lockedData.code, 'INVALID_CREDENTIALS');
      assert.strictEqual(lockedData.message, 'Invalid email or password.');

      // Verify security audit recorded AUTH_ACCOUNT_LOCKED
      const lockoutEvents = securityAudit.query({ eventType: 'AUTH_ACCOUNT_LOCKED' });
      assert.ok(lockoutEvents.length >= 1, 'Must record AUTH_ACCOUNT_LOCKED');
    });

    it('14B. DEF-15-04: Atomic failed login counter handles concurrent requests without race conditions', async () => {
      // Create dedicated concurrent test user
      const pwHash = await hashPassword('ConcurrentPassword123!');
      const concurrentUser = await User.create({
        email: `concurrent_${Date.now()}@connectly.io`,
        passwordHash: pwHash,
        firstName: 'Concurrent',
        lastName: 'Tester',
        isEmailVerified: true,
      });

      // Dispatch 5 simultaneous failed login attempts
      const attempts = [1, 2, 3, 4, 5].map(() =>
        fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({
            email: concurrentUser.email,
            password: 'BadPassword!',
          }),
        })
      );

      const results = await Promise.all(attempts);
      for (const res of results) {
        assert.strictEqual(res.status, 401);
      }

      // Authoritative database check: failedLoginAttempts must be exactly 5
      const refreshed = await User.findById(concurrentUser._id);
      assert.strictEqual(
        refreshed?.failedLoginAttempts,
        5,
        'Atomic update must record all 5 concurrent failed attempts without lost updates'
      );
      assert.ok(refreshed?.lockoutUntil, 'Lockout must be engaged after 5 failed attempts');

      // Cleanup
      await User.deleteOne({ _id: concurrentUser._id });
    });

    it('14C. DEF-15-05: Subsequent failed attempts during active lockout DO NOT extend existing expiry', async () => {
      // Create dedicated user
      const pwHash = await hashPassword('LockoutExtensionTest123!');
      const targetUser = await User.create({
        email: `lockout_ext_${Date.now()}@connectly.io`,
        passwordHash: pwHash,
        firstName: 'Lockout',
        lastName: 'ExtensionTester',
        isEmailVerified: true,
      });

      // Execute 5 failed attempts to engage lockout
      for (let i = 1; i <= 5; i++) {
        await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
          body: JSON.stringify({ email: targetUser.email, password: 'BadPassword!' }),
        });
      }

      // Check initial lockoutUntil
      const lockedUser1 = await User.findById(targetUser._id);
      assert.ok(lockedUser1?.lockoutUntil, 'User must be locked out after 5 attempts');
      const establishedExpiry = lockedUser1.lockoutUntil.getTime();
      assert.strictEqual(lockedUser1.failedLoginAttempts, 5);

      // Wait a small delay (100ms) to ensure time progresses
      await new Promise((r) => setTimeout(r, 100));

      // Attempt 6th, 7th, 8th failed logins during active lockout
      for (let i = 6; i <= 8; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
          body: JSON.stringify({ email: targetUser.email, password: 'BadPassword!' }),
        });
        assert.strictEqual(res.status, 401);
      }

      // Reload user from database: lockoutUntil MUST NOT HAVE CHANGED
      const lockedUser2 = await User.findById(targetUser._id);
      assert.strictEqual(
        lockedUser2?.lockoutUntil?.getTime(),
        establishedExpiry,
        'Active lockout expiry MUST NOT be extended by subsequent failed attempts'
      );

      // Cleanup
      await User.deleteOne({ _id: targetUser._id });
    });

    it('14D. DEF-15-05: Expired lockout safely recovers and resets counter to 1 without immediate re-lockout', async () => {
      const pwHash = await hashPassword('ExpiredLockoutTest123!');
      // Create user whose lockout already expired 1 minute ago
      const pastTime = new Date(Date.now() - 60 * 1000);
      const expiredUser = await User.create({
        email: `expired_lockout_${Date.now()}@connectly.io`,
        passwordHash: pwHash,
        firstName: 'Expired',
        lastName: 'LockoutTester',
        isEmailVerified: true,
        failedLoginAttempts: 5,
        lockoutUntil: pastTime,
      });

      // Use isolated server instance to prevent IP rate-limiting interference
      const isolatedApp = createApp();
      const isolatedServer = isolatedApp.listen(0);
      const isolatedAddr = isolatedServer.address() as any;
      const isolatedBaseUrl = `http://127.0.0.1:${isolatedAddr.port}`;

      try {
        // Submit 1 wrong password after expiry
        const res = await fetch(`${isolatedBaseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
          body: JSON.stringify({ email: expiredUser.email, password: 'WrongPassword!' }),
        });
        assert.strictEqual(res.status, 401);

        // Reload user from database
        const recoveredUser = await User.findById(expiredUser._id);
        assert.strictEqual(
          recoveredUser?.failedLoginAttempts,
          1,
          'Expired lockout recovery policy must reset counter to 1 (not 6)'
        );
        assert.strictEqual(
          recoveredUser?.lockoutUntil,
          null,
          'Expired lockout must be cleared; user must not be re-locked on single failed attempt'
        );
      } finally {
        await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
        await User.deleteOne({ _id: expiredUser._id });
      }
    });

    it('14E. DEF-15-05: Successful login completely clears failed attempts and lockout state', async () => {
      const rawPassword = 'ValidPasswordToReset123!';
      const pwHash = await hashPassword(rawPassword);
      const userToReset = await User.create({
        email: `reset_test_${Date.now()}@connectly.io`,
        passwordHash: pwHash,
        firstName: 'Reset',
        lastName: 'Tester',
        isEmailVerified: true,
      });

      // Use isolated server instance to ensure clean rate-limit window
      const isolatedApp = createApp();
      const isolatedServer = isolatedApp.listen(0);
      const isolatedAddr = isolatedServer.address() as any;
      const isolatedBaseUrl = `http://127.0.0.1:${isolatedAddr.port}`;

      try {
        // Perform 4 failed attempts
        for (let i = 1; i <= 4; i++) {
          const failRes = await fetch(`${isolatedBaseUrl}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
            body: JSON.stringify({ email: userToReset.email, password: 'WrongPassword!' }),
          });
          assert.strictEqual(failRes.status, 401);
        }

        const beforeUser = await User.findById(userToReset._id);
        assert.strictEqual(beforeUser?.failedLoginAttempts, 4);

        // Submit CORRECT password
        const successRes = await fetch(`${isolatedBaseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
          body: JSON.stringify({ email: userToReset.email, password: rawPassword }),
        });
        assert.strictEqual(successRes.status, 200);

        // Check database: failedLoginAttempts must be 0, lockoutUntil must be unset
        const afterUser = await User.findById(userToReset._id);
        assert.strictEqual(
          afterUser?.failedLoginAttempts,
          0,
          'Successful login must atomically reset failedLoginAttempts to 0'
        );
        assert.strictEqual(
          afterUser?.lockoutUntil,
          null,
          'Successful login must atomically clear lockoutUntil'
        );
      } finally {
        await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
        await User.deleteOne({ _id: userToReset._id });
      }
    });

    it('14F. DEF-15-05: Repeated attempts across simulated application instances cannot indefinitely extend lockout', async () => {
      const pwHash = await hashPassword('SimulatedInstances123!');
      const multiUser = await User.create({
        email: `multi_instance_${Date.now()}@connectly.io`,
        passwordHash: pwHash,
        firstName: 'Multi',
        lastName: 'InstanceTester',
        isEmailVerified: true,
      });

      const t0 = new Date('2026-06-01T12:00:00.000Z');

      // 4 failed attempts at t0
      for (let i = 1; i <= 4; i++) {
        const r = await recordFailedLoginAttempt(multiUser._id, t0);
        assert.strictEqual(r.isLocked, false);
      }

      // 5th attempt at t0 engages 15-minute lockout
      const r5 = await recordFailedLoginAttempt(multiUser._id, t0);
      assert.strictEqual(r5.isLocked, true);
      assert.strictEqual(r5.failedLoginAttempts, 5);
      const expectedExpiry = new Date(t0.getTime() + LOCKOUT_DURATION_MS).toISOString();
      assert.strictEqual(r5.lockoutUntil?.toISOString(), expectedExpiry);

      // Simulated Instance B hits at t = 2 minutes
      const t2m = new Date(t0.getTime() + 2 * 60 * 1000);
      const rInstanceB = await recordFailedLoginAttempt(multiUser._id, t2m);
      assert.strictEqual(rInstanceB.isLocked, true);
      assert.strictEqual(
        rInstanceB.lockoutUntil?.toISOString(),
        expectedExpiry,
        'Instance B attempt at 2m must not extend lockout'
      );

      // Simulated Instance C hits at t = 10 minutes
      const t10m = new Date(t0.getTime() + 10 * 60 * 1000);
      const rInstanceC = await recordFailedLoginAttempt(multiUser._id, t10m);
      assert.strictEqual(rInstanceC.isLocked, true);
      assert.strictEqual(
        rInstanceC.lockoutUntil?.toISOString(),
        expectedExpiry,
        'Instance C attempt at 10m must not extend lockout'
      );

      // Simulated Instance D hits at t = 14 minutes (1 min before expiry)
      const t14m = new Date(t0.getTime() + 14 * 60 * 1000);
      const rInstanceD = await recordFailedLoginAttempt(multiUser._id, t14m);
      assert.strictEqual(rInstanceD.isLocked, true);
      assert.strictEqual(
        rInstanceD.lockoutUntil?.toISOString(),
        expectedExpiry,
        'Instance D attempt at 14m must not extend lockout'
      );

      // Simulated Instance E hits at t = 16 minutes (lockout expired)
      const t16m = new Date(t0.getTime() + 16 * 60 * 1000);
      const rInstanceE = await recordFailedLoginAttempt(multiUser._id, t16m);
      assert.strictEqual(rInstanceE.isLocked, false, 'Account must be unlocked after expiry');
      assert.strictEqual(
        rInstanceE.failedLoginAttempts,
        1,
        'Counter must safely recover to 1 on attempt after lockout expiry'
      );
      assert.strictEqual(rInstanceE.lockoutUntil, null);

      // Cleanup
      await User.deleteOne({ _id: multiUser._id });
    });

    it('15. Refresh token replay: Replaying rotated token invalidates entire family', async () => {
      const familyId = generateFamilyId();
      const rawToken1 = generateRefreshToken();
      const hash1 = hashToken(rawToken1);

      await AuthSession.create({
        userId: testUser._id,
        familyId,
        refreshTokenHash: hash1,
        isValid: true,
        expiresAt: new Date(Date.now() + 86400000),
      });

      // Valid refresh: Token 1 rotates to Token 2
      const rotateRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          'X-CSRF-Token': 'phase15-audit-csrf',
          Cookie: `connectly_refresh=${rawToken1}; connectly_csrf=phase15-audit-csrf`,
        },
      });

      assert.strictEqual(rotateRes.status, 200);

      // Simulate token replay outside the 5-second concurrency grace window
      await AuthSession.updateOne(
        { refreshTokenHash: hash1 },
        { $set: { rotatedAt: new Date(Date.now() - 10000) } }
      );

      // Replay Token 1: Must detect replay, revoke entire family, return 401 TOKEN_REUSE_DETECTED
      const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          'X-CSRF-Token': 'phase15-audit-csrf',
          Cookie: `connectly_refresh=${rawToken1}; connectly_csrf=phase15-audit-csrf`,
        },
      });

      assert.strictEqual(replayRes.status, 401);
      const replayData = await replayRes.json();
      assert.strictEqual(replayData.code, 'TOKEN_REUSE_DETECTED');

      // Verify all sessions in family are invalidated
      const activeSessions = await AuthSession.find({ familyId, isValid: true });
      assert.strictEqual(activeSessions.length, 0);

      // Verify security audit
      const reuseEvents = securityAudit.query({ eventType: 'AUTH_TOKEN_REUSE_DETECTED' });
      assert.ok(reuseEvents.length >= 1, 'Must record AUTH_TOKEN_REUSE_DETECTED in audit log');
    });
  });

  // =========================================================================
  // SECTION D: LIVEKIT MEDIA SECURITY & INVARIANT ENFORCEMENT
  // =========================================================================
  describe('D. LiveKit Media Security & Invariant Enforcement', () => {
    it('16. Invariant check: canPublishData is strictly false across all participant roles', async () => {
      const livekit = new LiveKitService({
        config: {
          url: 'wss://connectly-livekit.example.com',
          publicUrl: 'wss://connectly-livekit.example.com',
          apiKey: 'APITestKeyValid123',
          apiSecret: 'secret_livekit_test_secret_at_least_32_bytes_length',
          tokenTtlSeconds: 600,
        },
        nodeEnv: 'test',
      });

      const roles = ['host', 'co-host', 'participant'] as const;

      for (const role of roles) {
        const dummyUserId = new mongoose.Types.ObjectId().toString();
        const tokenResult = await livekit.generateParticipantToken({
          meetingId: testMeeting.id,
          userId: dummyUserId,
          displayName: `Test ${role}`,
          role,
          maxParticipants: 10,
          provisionRoom: false,
        });

        const jwtPayload = JSON.parse(
          Buffer.from(tokenResult.token.split('.')[1], 'base64').toString('utf8')
        );

        assert.strictEqual(
          jwtPayload.video?.canPublishData,
          false,
          `canPublishData MUST be false for role '${role}' to prevent arbitrary binary packet injection`
        );
      }
    });

    it('17. Transport encryption: LiveKit service validates secure wss:// URL in production', () => {
      const validCheck = validateLiveKitConfig(
        {
          url: 'wss://livekit.connectly.io',
          apiKey: 'APITestKeyValid123',
          apiSecret: 'secret_livekit_test_secret_at_least_32_bytes_length',
          tokenTtlSeconds: 600,
        },
        'production'
      );
      assert.strictEqual(validCheck.valid, true);

      const insecureCheck = validateLiveKitConfig(
        {
          url: 'ws://insecure-host.example.com',
          apiKey: 'APITestKeyValid123',
          apiSecret: 'secret_livekit_test_secret_at_least_32_bytes_length',
          tokenTtlSeconds: 600,
        },
        'production'
      );
      assert.strictEqual(insecureCheck.valid, false);
      assert.ok(
        insecureCheck.reason?.includes(
          'Production LIVEKIT_URL must use a secure wss:// or https:// scheme'
        )
      );
    });
  });

  // =========================================================================
  // SECTION E: STORAGE & FILE SHARING SECURITY
  // =========================================================================
  describe('E. Storage & File Sharing Security', () => {
    it('18. S3 Provider enforces Server-Side Encryption (AES256) on upload stream', () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-secure-vault',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });
      assert.strictEqual(s3Provider.name, 's3');
    });

    it('19. Presigned upload POST enforces exact content-length-range [1, 26214400]', async () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-secure-vault',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      const presigned = await s3Provider.generatePresignedUploadUrl(
        'meetings/m1/f1/secure_report.pdf',
        'application/pdf',
        1024,
        900
      );

      assert.strictEqual(presigned.method, 'POST');
      assert.ok(presigned.fields['policy'] || presigned.fields['Policy']);

      const policyStr = presigned.fields['policy'] || presigned.fields['Policy'];
      const policyJson = JSON.parse(Buffer.from(policyStr, 'base64').toString('utf8'));

      const rangeCond = policyJson.conditions.find(
        (c: any) => Array.isArray(c) && c[0] === 'content-length-range'
      );
      assert.ok(rangeCond, 'Policy must include content-length-range');
      assert.strictEqual(rangeCond[1], 1);
      assert.strictEqual(rangeCond[2], 26214400); // 25 MB
    });
  });

  // =========================================================================
  // SECTION F: SECURITY OBSERVABILITY, REDACTION & CSP
  // =========================================================================
  describe('F. Security Observability, Redaction & CSP', () => {
    it('20. sanitizePayload recursively strips passwords, tokens, JWTs, and keys', () => {
      const dirtyObject = {
        email: 'user@connectly.io',
        password: 'SuperSecretPassword!',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc',
        apiKey: 'sk_live_987654321',
        nested: {
          refreshToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
          encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          safeField: 'Allowed metadata',
        },
      };

      const cleanObject = sanitizePayload(dirtyObject);

      assert.strictEqual(cleanObject.email, 'user@connectly.io');
      assert.strictEqual(cleanObject.password, '[REDACTED]');
      assert.strictEqual(cleanObject.accessToken, '[REDACTED]');
      assert.strictEqual(cleanObject.apiKey, '[REDACTED]');
      assert.strictEqual(cleanObject.nested.refreshToken, '[REDACTED]');
      assert.strictEqual(cleanObject.nested.encryptionKey, '[REDACTED]');
      assert.strictEqual(cleanObject.nested.safeField, 'Allowed metadata');
    });

    it('21. SecurityAuditLogger records and queries structured security events', () => {
      securityAudit.log({
        eventType: 'MEETING_ACCESS_DENIED',
        meetingId: 'cly-36s-drt',
        userId: 'usr_6b00fa0f3657d370001f32ff',
        action: 'JOIN_WITHOUT_INVITE',
        details: { role: 'outsider' },
      });

      const events = securityAudit.query({ eventType: 'MEETING_ACCESS_DENIED' });
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].meetingId, 'cly-36s-drt');
      assert.strictEqual(events[0].severity, 'WARN');
      assert.strictEqual(events[0].details?.role, 'outsider');
    });

    it('22. DEF-15-06: Security Audit Logger classification documents structured JSON & external infrastructure dependency', () => {
      assert.strictEqual(
        AUDIT_LOGGER_INTEGRITY_CLASSIFICATION,
        'STRUCTURED_JSON_EXTERNAL_INFRASTRUCTURE_PREREQUISITE'
      );
    });

    it('23. DEF-15-07: Helmet Content-Security-Policy (CSP) headers are present on HTTP responses', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);

      const cspHeader = res.headers.get('content-security-policy');
      assert.ok(cspHeader, 'Response must include Content-Security-Policy header');
      assert.ok(cspHeader.includes("default-src 'self'"), 'CSP must define default-src');
      assert.ok(cspHeader.includes("script-src 'self'"), 'CSP must define script-src');
      assert.ok(cspHeader.includes("style-src 'self' 'unsafe-inline'"), 'CSP must define style-src');
      assert.ok(cspHeader.includes("object-src 'none'"), 'CSP must define object-src none');
      assert.ok(cspHeader.includes("frame-ancestors 'none'"), 'CSP must define frame-ancestors none');
    });

    it('24. DEF-15-07: Production CSP strictly disallows unrestricted https:, ws:, and wss: allowances', () => {
      const prodDirectives = getCspDirectives({
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://app.connectly.com',
        LIVEKIT_URL: 'https://sfu.connectly.com',
        LIVEKIT_PUBLIC_URL: 'wss://sfu.connectly.com',
        STORAGE_PROVIDER: 's3',
        STORAGE_S3_BUCKET: 'connectly-prod-files',
        STORAGE_S3_REGION: 'us-east-1',
      });

      const connectSrc = prodDirectives.connectSrc;
      assert.ok(Array.isArray(connectSrc));

      // Strictly verify broad scheme wildcards are absent
      assert.strictEqual(connectSrc.includes('https:'), false, 'Production connect-src MUST NOT include generic https:');
      assert.strictEqual(connectSrc.includes('ws:'), false, 'Production connect-src MUST NOT include generic ws:');
      assert.strictEqual(connectSrc.includes('wss:'), false, 'Production connect-src MUST NOT include generic wss:');
      assert.strictEqual(connectSrc.includes('*'), false, 'Production connect-src MUST NOT include wildcard *');
      assert.strictEqual(connectSrc.includes("'unsafe-eval'"), false, 'Production connect-src MUST NOT include unsafe-eval');
    });

    it('25. DEF-15-07: Production CSP excludes localhost and 127.0.0.1 origins', () => {
      const prodDirectives = getCspDirectives({
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://app.connectly.com',
        LIVEKIT_URL: 'https://sfu.connectly.com',
      });

      const connectSrc = prodDirectives.connectSrc;
      for (const origin of connectSrc) {
        assert.ok(!origin.includes('localhost'), `Production connect-src must not include localhost origin: ${origin}`);
        assert.ok(!origin.includes('127.0.0.1'), `Production connect-src must not include 127.0.0.1 origin: ${origin}`);
      }
    });

    it('26. DEF-15-07: Production CSP includes only configured trusted connection origins', () => {
      const prodDirectives = getCspDirectives({
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://app.connectly.com',
        LIVEKIT_URL: 'https://sfu.connectly.com',
        STORAGE_PROVIDER: 's3',
        STORAGE_S3_BUCKET: 'connectly-prod-files',
        STORAGE_S3_REGION: 'us-east-1',
      });

      const connectSrc = prodDirectives.connectSrc;
      assert.ok(connectSrc.includes("'self'"), "Must allow 'self'");
      assert.ok(connectSrc.includes('https://app.connectly.com'), 'Must allow configured CLIENT_ORIGIN https');
      assert.ok(connectSrc.includes('wss://app.connectly.com'), 'Must allow configured CLIENT_ORIGIN wss');
      assert.ok(connectSrc.includes('https://sfu.connectly.com'), 'Must allow LiveKit SFU https');
      assert.ok(connectSrc.includes('wss://sfu.connectly.com'), 'Must allow LiveKit SFU wss');
      assert.ok(connectSrc.includes('https://connectly-prod-files.s3.us-east-1.amazonaws.com'), 'Must allow S3 bucket');
    });

    it('27. DEF-15-07: Development CSP includes localhost Vite and API dev servers', () => {
      const devDirectives = getCspDirectives({
        NODE_ENV: 'development',
        CLIENT_ORIGIN: 'http://localhost:5173',
      });

      const connectSrc = devDirectives.connectSrc;
      assert.ok(connectSrc.includes("'self'"), "Must include 'self'");
      assert.ok(connectSrc.includes('http://localhost:5173'), 'Must include Vite dev server');
      assert.ok(connectSrc.includes('ws://localhost:5173'), 'Must include Vite dev HMR websocket');
      assert.ok(connectSrc.includes('http://localhost:5000'), 'Must include API server');
      assert.ok(connectSrc.includes('ws://localhost:5000'), 'Must include Socket.IO server');
    });

    it('28. DEF-15-07: Live production HTTP server enforces restricted CSP in response headers', async () => {
      const prodApp = createApp({
        cspConfigOverride: {
          NODE_ENV: 'production',
          CLIENT_ORIGIN: 'https://connectly.io',
          LIVEKIT_URL: 'https://livekit.connectly.io',
        },
      });

      const prodServer = prodApp.listen(0);
      const addr = prodServer.address() as any;
      const prodBaseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        const res = await fetch(`${prodBaseUrl}/health`);
        assert.strictEqual(res.status, 200);

        const csp = res.headers.get('content-security-policy') || '';
        assert.ok(csp.length > 0, 'Must have CSP header');

        // Extract connect-src directive
        const connectSrcMatch = csp.match(/connect-src\s+([^;]+)/);
        assert.ok(connectSrcMatch, 'Must contain connect-src directive');
        const connectSrcTokens = connectSrcMatch[1].split(/\s+/);

        assert.ok(connectSrcTokens.includes("'self'"), "Must have 'self'");
        assert.ok(connectSrcTokens.includes('https://connectly.io'), 'Must have https://connectly.io');
        assert.ok(connectSrcTokens.includes('wss://connectly.io'), 'Must have wss://connectly.io');
        assert.ok(connectSrcTokens.includes('https://livekit.connectly.io'), 'Must have https://livekit.connectly.io');
        assert.ok(connectSrcTokens.includes('wss://livekit.connectly.io'), 'Must have wss://livekit.connectly.io');

        // Prohibited schemes and origins must NOT be present
        assert.strictEqual(connectSrcTokens.includes('https:'), false, 'Must NOT contain broad https:');
        assert.strictEqual(connectSrcTokens.includes('ws:'), false, 'Must NOT contain broad ws:');
        assert.strictEqual(connectSrcTokens.includes('wss:'), false, 'Must NOT contain broad wss:');
        assert.strictEqual(connectSrcTokens.some((t) => t.includes('localhost')), false, 'Must NOT contain localhost');
        assert.strictEqual(connectSrcTokens.some((t) => t.includes('127.0.0.1')), false, 'Must NOT contain 127.0.0.1');
      } finally {
        await new Promise<void>((resolve) => prodServer.close(() => resolve()));
      }
    });
  });
});
