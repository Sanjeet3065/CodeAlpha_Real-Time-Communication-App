import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { User } from '../models/User.model.js';
import { UserPreferences } from '../models/UserPreferences.model.js';
import { AuthSession } from '../models/Session.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { ChatMessage } from '../models/ChatMessage.model.js';
import { SharedFile } from '../models/SharedFile.model.js';
import { Whiteboard } from '../models/Whiteboard.model.js';
import { WhiteboardOperation } from '../models/WhiteboardOperation.model.js';
import { Notification } from '../models/Notification.model.js';
import { ScheduledReminder } from '../models/ScheduledReminder.model.js';
import { MeetingRealtimeEvent } from '../models/MeetingRealtimeEvent.model.js';
import {
  LiveKitRevocationCounter,
  LiveKitRevocationCursor,
  LiveKitRevocationEvent,
} from '../models/LiveKitRevocationEvent.model.js';
import { LiveKitEvictionJob } from '../models/LiveKitEvictionJob.model.js';
import { SecurityAuditEntry } from '../models/SecurityAuditEntry.model.js';
import { generateHex24Id, isSupabaseActive } from '../config/supabase.js';
import {
  applyUpdate,
  attachDocumentMethods,
  cloneValue,
  createMongoDuplicateError,
  evaluateAggregation,
  getByPath,
  matchesFilter,
  projectFields,
  sortDocs,
  SupabaseQuery,
  valuesEqual,
  type PlainDoc,
} from './supabaseDocEngine.js';
import {
  authSessionAdapter,
  chatMessageAdapter,
  livekitEvictionJobAdapter,
  livekitRevocationCounterAdapter,
  livekitRevocationCursorAdapter,
  livekitRevocationEventAdapter,
  meetingAdapter,
  meetingRealtimeEventAdapter,
  notificationAdapter,
  participantAdapter,
  scheduledReminderAdapter,
  securityAuditEntryAdapter,
  sharedFileAdapter,
  userAdapter,
  userPreferencesAdapter,
  whiteboardAdapter,
  whiteboardOpAdapter,
  type TableAdapter,
} from './supabaseMappers.js';

interface BridgeModelConfig {
  model: any;
  name: string;
  adapter: TableAdapter;
  defaults?: () => PlainDoc;
  uniqueKeys?: Array<{ fields: string[]; sparse?: boolean }>;
  normalizeInput?: (doc: PlainDoc) => PlainDoc;
}

const modelBridges = new Map<string, SupabaseModelBridge>();
let bridgeInstalled = false;

class SupabaseModelBridge {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly cfg: BridgeModelConfig) {}

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queue.catch(() => undefined);
    const next = prev.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private normalizeDoc(raw: PlainDoc, applyDefs: boolean): PlainDoc {
    let doc = cloneValue(raw);
    if (applyDefs && this.cfg.defaults) {
      const defs = this.cfg.defaults();
      for (const [k, v] of Object.entries(defs)) {
        if (doc[k] === undefined) {
          doc[k] = v;
        }
      }
    }
    if (!doc._id) {
      doc._id = new Types.ObjectId(generateHex24Id());
    } else if (typeof doc._id === 'string' && Types.ObjectId.isValid(doc._id)) {
      doc._id = new Types.ObjectId(doc._id);
    }
    if (this.cfg.normalizeInput) {
      doc = this.cfg.normalizeInput(doc);
    }
    const now = new Date();
    if (!doc.createdAt) doc.createdAt = now;
    if (!doc.updatedAt) doc.updatedAt = now;
    return doc;
  }

  private checkUniqueness(existingDocs: PlainDoc[], candidate: PlainDoc, ignoreId?: unknown): void {
    const rules = this.cfg.uniqueKeys || [];
    for (const rule of rules) {
      const candidateVals = rule.fields.map((f) => getByPath(candidate, f));
      if (rule.sparse && candidateVals.some((v) => v === null || v === undefined)) {
        continue;
      }
      for (const ex of existingDocs) {
        if (ignoreId !== undefined && valuesEqual(ex._id, ignoreId)) continue;
        const exVals = rule.fields.map((f) => getByPath(ex, f));
        if (candidateVals.every((v, idx) => valuesEqual(v, exVals[idx]))) {
          const pattern: Record<string, number> = {};
          for (const f of rule.fields) pattern[f] = 1;
          throw createMongoDuplicateError(
            `E11000 duplicate key error on ${this.cfg.name} (${rule.fields.join(', ')})`,
            pattern
          );
        }
      }
    }
  }

  private wrap(doc: PlainDoc | null, isLean: boolean): any {
    if (!doc) return null;
    if (isLean) return doc;
    return attachDocumentMethods(doc, async (mutated) => {
      return this.withLock(async () => {
        const saved = await this.cfg.adapter.replace(mutated);
        return this.wrap(saved, false);
      });
    });
  }

  private async applyPopulate(
    docs: PlainDoc[],
    populates: Array<{ path: string; select?: string }>
  ): Promise<PlainDoc[]> {
    if (!populates.length || !docs.length) return docs;
    const userBridge = modelBridges.get('User');
    if (!userBridge) return docs;
    const users = await userBridge.cfg.adapter.loadAll();

    for (const doc of docs) {
      for (const pop of populates) {
        const refVal = doc[pop.path];
        if (!refVal) continue;
        const matchUser = users.find((u) => valuesEqual(u._id, refVal));
        if (matchUser) {
          doc[pop.path] = pop.select
            ? projectFields(matchUser, pop.select)
            : cloneValue(matchUser);
        }
      }
    }
    return docs;
  }

  private async loadForFilter(filter: PlainDoc = {}): Promise<PlainDoc[]> {
    if (this.cfg.adapter.loadFiltered) {
      return this.cfg.adapter.loadFiltered(filter);
    }
    return this.cfg.adapter.loadAll();
  }

  public install(): void {
    const model = this.cfg.model;

    model.find = (filter: PlainDoc = {}, projection?: any) =>
      new SupabaseQuery(async (opts) => {
        const all = await this.loadForFilter(filter);
        let rows = all.filter((d) => matchesFilter(d, filter));
        if (opts.sortSpec) rows = sortDocs(rows, opts.sortSpec);
        if (opts.skipCount > 0) rows = rows.slice(opts.skipCount);
        if (opts.limitCount !== null) rows = rows.slice(0, opts.limitCount);
        if (opts.populates.length > 0) {
          rows = await this.applyPopulate(rows, opts.populates);
        }
        const sel = opts.selectSpec ?? projection ?? null;
        if (sel) rows = rows.map((r) => projectFields(r, sel));
        return rows.map((r) => this.wrap(r, opts.isLean));
      });

    model.findOne = (filter: PlainDoc = {}, projection?: any) =>
      new SupabaseQuery(async (opts) => {
        const all = await this.loadForFilter(filter);
        let rows = all.filter((d) => matchesFilter(d, filter));
        if (opts.sortSpec) rows = sortDocs(rows, opts.sortSpec);
        let match = rows[0] ?? null;
        if (match && opts.populates.length > 0) {
          [match] = await this.applyPopulate([match], opts.populates);
        }
        const sel = opts.selectSpec ?? projection ?? null;
        if (match && sel) match = projectFields(match, sel);
        return this.wrap(match, opts.isLean);
      });

    model.findById = (id: unknown, projection?: any) => {
      if (id === null || id === undefined || id === '') {
        return new SupabaseQuery(async () => null);
      }
      return model.findOne({ _id: id }, projection);
    };

    model.countDocuments = (filter: PlainDoc = {}) =>
      new SupabaseQuery(async () => {
        const all = await this.loadForFilter(filter);
        return all.filter((d) => matchesFilter(d, filter)).length;
      });

    model.exists = (filter: PlainDoc = {}) =>
      new SupabaseQuery(async () => {
        const all = await this.loadForFilter(filter);
        const match = all.find((d) => matchesFilter(d, filter));
        return match ? { _id: match._id } : null;
      });

    model.aggregate = (pipeline: PlainDoc[]) =>
      new SupabaseQuery(async () => {
        const all = await this.cfg.adapter.loadAll();
        return evaluateAggregation(all, pipeline);
      });

    model.create = async (input: PlainDoc | PlainDoc[]) => {
      return this.withLock(async () => {
        const isArr = Array.isArray(input);
        const list = isArr ? input : [input];
        const existing = await this.cfg.adapter.loadAll();
        const created: any[] = [];
        for (const item of list) {
          const normalized = this.normalizeDoc(item, true);
          this.checkUniqueness(existing, normalized);
          const inserted = await this.cfg.adapter.insert(normalized);
          existing.push(inserted);
          created.push(this.wrap(inserted, false));
        }
        return isArr ? created : created[0];
      });
    };

    model.insertMany = async (items: PlainDoc[]) => {
      return model.create(items);
    };

    model.updateOne = (filter: PlainDoc, update: PlainDoc | PlainDoc[], options: PlainDoc = {}) =>
      new SupabaseQuery(async () =>
        this.withLock(async () => {
          const all = await this.cfg.adapter.loadAll();
          const match = all.find((d) => matchesFilter(d, filter));
          if (!match) {
            if (options?.upsert) {
              const seeded = this.normalizeDoc(
                applyUpdate(null, update, { isInsert: true }),
                true
              );
              // Seed equality criteria from filter when upserting
              for (const [k, v] of Object.entries(filter)) {
                if (!k.startsWith('$') && (typeof v !== 'object' || v instanceof Types.ObjectId || v instanceof Date)) {
                  if (k === '_id' || seeded[k] === undefined) seeded[k] = cloneValue(v);
                }
              }
              this.checkUniqueness(all, seeded);
              await this.cfg.adapter.insert(seeded);
              return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          }
          const next = this.normalizeDoc(applyUpdate(match, update, { isInsert: false }), false);
          this.checkUniqueness(all, next, match._id);
          await this.cfg.adapter.replace(next);
          return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        })
      );

    model.updateMany = (filter: PlainDoc, update: PlainDoc | PlainDoc[]) =>
      new SupabaseQuery(async () =>
        this.withLock(async () => {
          const all = await this.cfg.adapter.loadAll();
          const matches = all.filter((d) => matchesFilter(d, filter));
          let modifiedCount = 0;
          for (const match of matches) {
            const next = this.normalizeDoc(applyUpdate(match, update, { isInsert: false }), false);
            await this.cfg.adapter.replace(next);
            modifiedCount += 1;
          }
          return { acknowledged: true, matchedCount: matches.length, modifiedCount };
        })
      );

    model.findOneAndUpdate = (
      filter: PlainDoc,
      update: PlainDoc | PlainDoc[],
      options: PlainDoc = {}
    ) =>
      new SupabaseQuery(async (queryOpts) =>
        this.withLock(async () => {
          const all = await this.cfg.adapter.loadAll();
          let rows = all.filter((d) => matchesFilter(d, filter));
          if (options.sort) rows = sortDocs(rows, options.sort);
          else if (queryOpts.sortSpec) rows = sortDocs(rows, queryOpts.sortSpec);
          const match = rows[0] ?? null;

          const returnAfter =
            options.new === true || options.returnDocument === 'after';

          if (!match) {
            if (!options.upsert) return null;
            const seeded = this.normalizeDoc(
              applyUpdate(null, update, { isInsert: true }),
              true
            );
            for (const [k, v] of Object.entries(filter)) {
              if (!k.startsWith('$') && (typeof v !== 'object' || v instanceof Types.ObjectId || v instanceof Date)) {
                if (k === '_id' || seeded[k] === undefined) seeded[k] = cloneValue(v);
              }
            }
            this.checkUniqueness(all, seeded);
            const inserted = await this.cfg.adapter.insert(seeded);
            if (!returnAfter && options.new === false) return null;
            const out = queryOpts.selectSpec ? projectFields(inserted, queryOpts.selectSpec) : inserted;
            return this.wrap(out, queryOpts.isLean);
          }

          const next = this.normalizeDoc(applyUpdate(match, update, { isInsert: false }), false);
          this.checkUniqueness(all, next, match._id);
          const saved = await this.cfg.adapter.replace(next);
          const chosen = returnAfter ? saved : match;
          const out = queryOpts.selectSpec ? projectFields(chosen, queryOpts.selectSpec) : chosen;
          return this.wrap(out, queryOpts.isLean);
        })
      );

    model.findByIdAndUpdate = (
      id: unknown,
      update: PlainDoc | PlainDoc[],
      options: PlainDoc = {}
    ) => model.findOneAndUpdate({ _id: id }, update, options);

    model.deleteOne = (filter: PlainDoc) =>
      new SupabaseQuery(async () =>
        this.withLock(async () => {
          const all = await this.loadForFilter(filter);
          const match = all.find((d) => matchesFilter(d, filter));
          if (!match) return { acknowledged: true, deletedCount: 0 };
          await this.cfg.adapter.remove(match._id);
          return { acknowledged: true, deletedCount: 1 };
        })
      );

    model.deleteMany = (filter: PlainDoc = {}) =>
      new SupabaseQuery(async () =>
        this.withLock(async () => {
          const all = await this.loadForFilter(filter);
          const matches = all.filter((d) => matchesFilter(d, filter));
          for (const m of matches) {
            await this.cfg.adapter.remove(m._id);
          }
          return { acknowledged: true, deletedCount: matches.length };
        })
      );

    model.init = async () => {};
    model.createCollection = async () => {};
    model.createIndexes = async () => {};

    Object.defineProperty(model, 'collection', {
      configurable: true,
      get: () => ({
        collectionName: this.cfg.name.toLowerCase(),
        find: (filter: PlainDoc = {}) => ({
          toArray: async () => {
            const all = await this.loadForFilter(filter);
            return all.filter((d) => matchesFilter(d, filter));
          },
        }),
        updateOne: (filter: PlainDoc, update: PlainDoc, options: PlainDoc = {}) =>
          model.updateOne(filter, update, options).exec(),
        findOneAndUpdate: (
          filter: PlainDoc,
          update: PlainDoc | PlainDoc[],
          options: PlainDoc = {}
        ) => model.findOneAndUpdate(filter, update, options).lean().exec(),
        indexes: async () => [],
        dropIndex: async () => {},
      }),
    });
  }
}

export function installSupabaseBridge(): void {
  if (bridgeInstalled || !isSupabaseActive()) {
    return;
  }

  const configs: BridgeModelConfig[] = [
    {
      model: User,
      name: 'User',
      adapter: userAdapter,
      uniqueKeys: [{ fields: ['email'] }],
      defaults: () => ({
        role: 'user',
        avatarColor: 'sage',
        hasLocalPassword: true,
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        preferencesVersion: 0,
        preferences: {
          defaultAudioMuted: true,
          defaultVideoOff: false,
          enableVirtualBackground: false,
          theme: 'editorial-light',
          notificationSounds: true,
        },
      }),
      normalizeInput: (doc) => {
        if (typeof doc.email === 'string') doc.email = doc.email.toLowerCase().trim();
        return doc;
      },
    },
    {
      model: UserPreferences,
      name: 'UserPreferences',
      adapter: userPreferencesAdapter,
      uniqueKeys: [{ fields: ['userId'] }],
      defaults: () => ({
        defaultAudioMuted: true,
        defaultVideoOff: false,
        version: 1,
        fieldVersions: { defaultAudioMuted: 0, defaultVideoOff: 0 },
        fieldTimestamps: { defaultAudioMuted: 0, defaultVideoOff: 0 },
        fieldMeta: {
          defaultAudioMuted: { clientSessionId: '', serverUpdatedAt: new Date(0), lastWriteId: '' },
          defaultVideoOff: { clientSessionId: '', serverUpdatedAt: new Date(0), lastWriteId: '' },
        },
      }),
    },
    {
      model: AuthSession,
      name: 'AuthSession',
      adapter: authSessionAdapter,
      uniqueKeys: [{ fields: ['refreshTokenHash'] }],
      defaults: () => ({
        isValid: true,
        rotatedAt: null,
        userAgent: 'Unknown',
        ipAddress: 'Unknown',
      }),
    },
    {
      model: Meeting,
      name: 'Meeting',
      adapter: meetingAdapter,
      uniqueKeys: [{ fields: ['meetingCode'] }],
      defaults: () => ({
        status: 'ACTIVE',
        isLocked: false,
        maxParticipants: 100,
        activeParticipantCount: 0,
        settings: {
          waitingRoomEnabled: false,
          allowCoHostAdmit: true,
          allowCoHostRemove: true,
          allowCoHostLock: false,
        },
        invitees: [],
        reminderPreferences: [15, 60],
        scheduleVersion: 1,
        version: 1,
        auditLog: [],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
      normalizeInput: (doc) => {
        if (typeof doc.meetingCode === 'string') doc.meetingCode = doc.meetingCode.toLowerCase().trim();
        return doc;
      },
    },
    {
      model: MeetingParticipant,
      name: 'MeetingParticipant',
      adapter: participantAdapter,
      uniqueKeys: [{ fields: ['meetingId', 'userId'] }],
      defaults: () => ({
        role: 'participant',
        admissionStatus: 'WAITING',
        presenceStatus: 'OFFLINE',
        admissionSessionId: null,
        requestedAt: new Date(),
        admittedAt: null,
        joinedAt: null,
        leftAt: null,
        tokenEpoch: 1,
        tokenRevokedBefore: null,
        signalFenceVersion: 0,
      }),
      normalizeInput: (doc) => {
        if (typeof doc.email === 'string') doc.email = doc.email.toLowerCase().trim();
        return doc;
      },
    },
    {
      model: ChatMessage,
      name: 'ChatMessage',
      adapter: chatMessageAdapter,
      uniqueKeys: [{ fields: ['meetingId', 'clientMessageId'], sparse: true }],
    },
    {
      model: SharedFile,
      name: 'SharedFile',
      adapter: sharedFileAdapter,
      uniqueKeys: [{ fields: ['storageKey'] }],
      defaults: () => ({
        status: 'PENDING',
        cleanupStatus: 'NONE',
        cleanupRetries: 0,
        isDeleted: false,
      }),
    },
    {
      model: Whiteboard,
      name: 'Whiteboard',
      adapter: whiteboardAdapter,
      uniqueKeys: [{ fields: ['meetingId'] }],
      defaults: () => ({
        version: 0,
        elements: new Map(),
        appliedOperationIds: [],
      }),
    },
    {
      model: WhiteboardOperation,
      name: 'WhiteboardOperation',
      adapter: whiteboardOpAdapter,
      defaults: () => ({
        isUndone: false,
      }),
    },
    {
      model: Notification,
      name: 'Notification',
      adapter: notificationAdapter,
      uniqueKeys: [{ fields: ['deliveryKey'], sparse: true }],
      defaults: () => ({
        read: false,
        readAt: null,
        metadata: {},
      }),
    },
    {
      model: ScheduledReminder,
      name: 'ScheduledReminder',
      adapter: scheduledReminderAdapter,
      uniqueKeys: [{ fields: ['meetingId', 'userId', 'triggerMinutesBefore'] }],
    },
    {
      model: MeetingRealtimeEvent,
      name: 'MeetingRealtimeEvent',
      adapter: meetingRealtimeEventAdapter,
      uniqueKeys: [{ fields: ['eventId'] }],
      defaults: () => ({
        eventId: crypto.randomUUID(),
        status: 'PENDING',
        attemptCount: 0,
        leaseOwner: null,
        leaseToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        dispatchedAt: null,
        suppressedAt: null,
        terminalAt: null,
        lastError: null,
      }),
    },
    {
      model: LiveKitRevocationEvent,
      name: 'LiveKitRevocationEvent',
      adapter: livekitRevocationEventAdapter,
      uniqueKeys: [{ fields: ['seq'] }],
    },
    {
      model: LiveKitRevocationCounter,
      name: 'LiveKitRevocationCounter',
      adapter: livekitRevocationCounterAdapter,
    },
    {
      model: LiveKitRevocationCursor,
      name: 'LiveKitRevocationCursor',
      adapter: livekitRevocationCursorAdapter,
    },
    {
      model: LiveKitEvictionJob,
      name: 'LiveKitEvictionJob',
      adapter: livekitEvictionJobAdapter,
      uniqueKeys: [{ fields: ['jobId'] }],
    },
    {
      model: SecurityAuditEntry,
      name: 'SecurityAuditEntry',
      adapter: securityAuditEntryAdapter,
    },
  ];

  for (const cfg of configs) {
    const bridge = new SupabaseModelBridge(cfg);
    bridge.install();
    modelBridges.set(cfg.name, bridge);
  }

  // Provide transaction session support without requiring a MongoDB driver connection
  const originalStartSession = mongoose.startSession.bind(mongoose);
  (mongoose as any).startSession = async (...args: any[]) => {
    if (isSupabaseActive()) {
      let ended = false;
      const fakeSession = {
        inTransaction: () => true,
        withTransaction: async (fn: (sess: any) => Promise<unknown>) => fn(fakeSession),
        startTransaction: () => {},
        commitTransaction: async () => {},
        abortTransaction: async () => {},
        endSession: async () => {
          ended = true;
        },
        get hasEnded() {
          return ended;
        },
      };
      return fakeSession;
    }
    return originalStartSession(...args);
  };

  bridgeInstalled = true;
}
