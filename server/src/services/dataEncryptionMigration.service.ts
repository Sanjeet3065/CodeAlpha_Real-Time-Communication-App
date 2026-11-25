import { Types } from 'mongoose';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { cryptoEngine, EnvelopeEncryptionEngine } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

export interface MigrationOptions {
  batchSize?: number;
  startingId?: string;
  dryRun?: boolean;
}

export interface MigrationResult {
  totalScanned: number;
  migratedCount: number;
  alreadyEncryptedCount: number;
  failedCount: number;
  lastProcessedId: string | null;
  isComplete: boolean;
  dryRun: boolean;
  errors?: Array<{ id: string; reason: string }>;
}

export interface KeyRotationMigrationResult {
  totalScanned: number;
  migratedCount: number;
  alreadyTargetVersionCount: number;
  failedCount: number;
  lastProcessedId: string | null;
  isComplete: boolean;
  targetVersion: string;
}

/**
 * Enterprise Data Encryption Migration Service.
 * Safely migrates legacy unencrypted database records to AES-256-GCM authenticated ciphertext,
 * and handles key rotation re-encryption across key versions in bounded, idempotent batches.
 */
export class DataEncryptionMigrationService {
  constructor(private readonly engine: EnvelopeEncryptionEngine = cryptoEngine) {}

  /**
   * Scans and migrates plaintext ChatMessage records to versioned AES-256-GCM ciphertext.
   * Guarantees idempotency, prevents double-encryption, avoids overwriting concurrent updates,
   * and verifies decryption after persistence.
   */
  public async migratePlaintextChatMessages(options?: MigrationOptions): Promise<MigrationResult> {
    const batchSize = Math.min(Math.max(options?.batchSize ?? 100, 1), 1000);
    const dryRun = options?.dryRun ?? false;
    const filter: Record<string, unknown> = {};

    if (options?.startingId && Types.ObjectId.isValid(options.startingId)) {
      filter._id = { $gt: new Types.ObjectId(options.startingId) };
    }

    // Query batch ordered by _id ascending for deterministic resumption
    // Use .lean() to bypass Mongoose getters and inspect raw stored values
    const docs = await ChatMessage.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    const totalScanned = docs.length;
    let migratedCount = 0;
    let alreadyEncryptedCount = 0;
    let failedCount = 0;
    let lastProcessedId: string | null = null;
    const errors: Array<{ id: string; reason: string }> = [];

    for (const doc of docs) {
      const docIdStr = doc._id.toString();
      lastProcessedId = docIdStr;
      const rawContent = (doc as any).content;

      // Check if already versioned ciphertext
      if (this.engine.isEncrypted(rawContent)) {
        alreadyEncryptedCount += 1;
        continue;
      }

      // Legacy plaintext record detected
      if (dryRun) {
        migratedCount += 1;
        continue;
      }

      try {
        const meetingIdStr = doc.meetingId ? doc.meetingId.toString() : '';
        const aad = `chat:${meetingIdStr}`;

        // Encrypt using active key and entity-bound AAD
        const ciphertext = this.engine.encrypt(rawContent, { aad });

        // Idempotent conditional update: only update if content still matches the raw plaintext
        // This guarantees concurrent edits by users are never silently overwritten
        const updateResult = await ChatMessage.updateOne(
          { _id: doc._id, content: rawContent },
          { $set: { content: ciphertext } }
        );

        if (updateResult.modifiedCount === 0) {
          // Record was either updated concurrently or already modified
          alreadyEncryptedCount += 1;
          continue;
        }

        // Post-migration verification: query and verify decryption
        const verifiedDoc = await ChatMessage.findById(doc._id).lean();
        const storedCiphertext = (verifiedDoc as any)?.content;

        if (!this.engine.isEncrypted(storedCiphertext)) {
          throw new Error('Verification failed: record was not stored as ciphertext.');
        }

        const decrypted = this.engine.decryptString(storedCiphertext, { aad });
        if (decrypted !== rawContent) {
          throw new Error('Verification failed: decrypted content does not match original plaintext.');
        }

        migratedCount += 1;
      } catch (err: unknown) {
        failedCount += 1;
        const reason = err instanceof Error ? err.message : String(err);
        errors.push({ id: docIdStr, reason });
        logger.error(`[DataEncryptionMigration] Failed to migrate ChatMessage '${docIdStr}'`, {
          metadata: { id: docIdStr, reason },
        });
      }
    }

    const isComplete = docs.length < batchSize;

    logger.info('[DataEncryptionMigration] Batch migration completed', {
      metadata: {
        totalScanned,
        migratedCount,
        alreadyEncryptedCount,
        failedCount,
        lastProcessedId,
        isComplete,
        dryRun,
      },
    });

    return {
      totalScanned,
      migratedCount,
      alreadyEncryptedCount,
      failedCount,
      lastProcessedId,
      isComplete,
      dryRun,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  /**
   * Re-encrypts ciphertext messages from an older key version to the target active key version.
   */
  public async migrateCiphertextToKeyVersion(
    targetVersion: string,
    options?: { batchSize?: number; startingId?: string }
  ): Promise<KeyRotationMigrationResult> {
    const batchSize = Math.min(Math.max(options?.batchSize ?? 100, 1), 1000);
    const filter: Record<string, unknown> = {};

    if (options?.startingId && Types.ObjectId.isValid(options?.startingId)) {
      filter._id = { $gt: new Types.ObjectId(options.startingId) };
    }

    const docs = await ChatMessage.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    const totalScanned = docs.length;
    let migratedCount = 0;
    let alreadyTargetVersionCount = 0;
    let failedCount = 0;
    let lastProcessedId: string | null = null;

    for (const doc of docs) {
      const docIdStr = doc._id.toString();
      lastProcessedId = docIdStr;
      const rawContent = (doc as any).content;

      if (!this.engine.isEncrypted(rawContent)) {
        // Plaintext messages are handled by migratePlaintextChatMessages
        continue;
      }

      const currentVer = rawContent.split(':')[0];
      if (currentVer === targetVersion) {
        alreadyTargetVersionCount += 1;
        continue;
      }

      try {
        const meetingIdStr = doc.meetingId ? doc.meetingId.toString() : '';
        const aad = `chat:${meetingIdStr}`;

        const newCiphertext = this.engine.migrateCiphertext(rawContent, {
          aad,
          targetVersion,
        });

        const updateResult = await ChatMessage.updateOne(
          { _id: doc._id, content: rawContent },
          { $set: { content: newCiphertext } }
        );

        if (updateResult.modifiedCount > 0) {
          migratedCount += 1;
        } else {
          alreadyTargetVersionCount += 1;
        }
      } catch (err: unknown) {
        failedCount += 1;
        logger.error(`[DataEncryptionMigration] Failed to re-encrypt ChatMessage '${docIdStr}'`, {
          metadata: { id: docIdStr, error: String(err) },
        });
      }
    }

    const isComplete = docs.length < batchSize;

    return {
      totalScanned,
      migratedCount,
      alreadyTargetVersionCount,
      failedCount,
      lastProcessedId,
      isComplete,
      targetVersion,
    };
  }
}

export const dataEncryptionMigration = new DataEncryptionMigrationService();
