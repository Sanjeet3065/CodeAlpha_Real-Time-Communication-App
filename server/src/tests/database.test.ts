import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  connectDatabase,
  disconnectDatabase,
  isDatabaseConnected,
  getDatabaseState,
} from '../config/database.js';
import { UserPreferences } from '../models/UserPreferences.model.js';

describe('Database Foundation & Model Validation Suite', () => {
  const testDbUri = 'mongodb://127.0.0.1:27017/connectly_db_lifecycle_test';

  before(async () => {
    await connectDatabase(testDbUri);
    await UserPreferences.init();
    await UserPreferences.deleteMany({});
  });

  after(async () => {
    await UserPreferences.deleteMany({});
    await disconnectDatabase();
  });

  it('1. should report connected state accurately', () => {
    assert.strictEqual(isDatabaseConnected(), true);
    const state = getDatabaseState();
    assert.strictEqual(state.status, 'connected');
    assert.strictEqual(state.readyState, 1);
  });

  it('2. should enforce default preferences on creation', async () => {
    const testUserId = new Types.ObjectId();
    const pref = await UserPreferences.create({
      userId: testUserId,
    });

    assert.strictEqual(pref.defaultAudioMuted, true);
    assert.strictEqual(pref.defaultVideoOff, false);
    assert.ok(pref.createdAt);
    assert.ok(pref.updatedAt);
  });

  it('3. should enforce unique userId constraint on UserPreferences collection', async () => {
    const duplicateUserId = new Types.ObjectId();
    await UserPreferences.create({
      userId: duplicateUserId,
      defaultAudioMuted: false,
      defaultVideoOff: true,
    });

    // Attempting to create a duplicate record for the same user must be rejected
    await assert.rejects(
      async () => {
        await UserPreferences.create({
          userId: duplicateUserId,
          defaultAudioMuted: true,
          defaultVideoOff: false,
        });
      },
      (err: any) => {
        return err.code === 11000 || err.name === 'MongoServerError';
      },
      'Database must enforce 1:1 uniqueness constraint per user'
    );
  });

  it('4. should reject document creation without required userId', async () => {
    await assert.rejects(
      async () => {
        await UserPreferences.create({
          defaultAudioMuted: true,
        });
      },
      (err: any) => {
        return err.name === 'ValidationError';
      },
      'UserPreferences creation must reject missing userId'
    );
  });
});
