import mongoose from 'mongoose';
import { env } from './env.js';
import {
  disconnectSupabase,
  initSupabase,
  isSupabaseActive,
  isSupabaseConnected,
  pingSupabase,
} from './supabase.js';
import { installSupabaseBridge } from '../repositories/supabaseModelBridge.js';

let isListenersAttached = false;

function attachConnectionListeners(): void {
  if (isListenersAttached) return;

  mongoose.connection.on('connected', () => {
    const { host, port, name } = mongoose.connection;
    console.log(`[Database] MongoDB connection established to ${host}:${port}/${name}`);
  });

  mongoose.connection.on('error', (err) => {
    console.error('[Database] MongoDB runtime connection error:', err.message || err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[Database] MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[Database] MongoDB reconnected successfully');
  });

  isListenersAttached = true;
}

export async function connectDatabase(customUri?: string): Promise<typeof mongoose> {
  if (!customUri && env.DB_PROVIDER === 'supabase' && !isSupabaseActive()) {
    throw new Error(
      '[Database] Fatal Supabase configuration error: DB_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.'
    );
  }

  if (!customUri && isSupabaseActive()) {
    initSupabase();
    installSupabaseBridge();
    const ok = await pingSupabase();
    if (!ok) {
      throw new Error(
        '[Database] Fatal Supabase connection error: unable to reach Supabase Cloud project.'
      );
    }
    console.log(`[Database] Supabase Cloud PostgreSQL connected (${env.SUPABASE_URL})`);
    return mongoose;
  }

  try {
    mongoose.set('strictQuery', true);
    attachConnectionListeners();

    const targetUri = customUri || env.MONGODB_URI;

    const conn = await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });

    return conn;
  } catch (error: any) {
    // Sanitize error logging to ensure credentials/URI are never leaked
    const safeMessage = error?.message?.replace(/mongodb(\+srv)?:\/\/[^@]+@/, 'mongodb://***:***@') || 'Unknown connection error';
    console.error('[Database] Fatal MongoDB connection error:', safeMessage);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (isSupabaseActive()) {
    await disconnectSupabase();
    console.log('[Database] Supabase client disconnected cleanly');
  }
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('[Database] MongoDB disconnected cleanly');
    }
  } catch (error) {
    console.error('[Database] Error disconnecting MongoDB:', error);
  }
}

export function isDatabaseConnected(): boolean {
  if (isSupabaseActive()) {
    return isSupabaseConnected();
  }
  return mongoose.connection.readyState === 1;
}

export function getDatabaseState(): {
  status: 'connected' | 'connecting' | 'disconnecting' | 'disconnected' | 'unknown';
  readyState: number;
  provider?: 'supabase' | 'mongo';
} {
  if (isSupabaseActive()) {
    const connected = isSupabaseConnected();
    return {
      status: connected ? 'connected' : 'disconnected',
      readyState: connected ? 1 : 0,
      provider: 'supabase',
    };
  }
  const readyState = mongoose.connection.readyState;
  switch (readyState) {
    case 1:
      return { status: 'connected', readyState };
    case 2:
      return { status: 'connecting', readyState };
    case 3:
      return { status: 'disconnecting', readyState };
    case 0:
    default:
      return { status: 'disconnected', readyState };
  }
}
