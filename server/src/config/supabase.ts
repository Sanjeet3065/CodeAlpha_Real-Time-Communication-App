import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let supabaseConnected = false;

export const SUPABASE_UUID_HEX24_PREFIX = 'c0000000';

function isNodeTestRunner(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test-'))) {
    return true;
  }
  return process.argv.some((arg) => /\.(test|spec)\.(ts|js|mts|mjs|cts|cjs)$/i.test(arg));
}

export function isSupabaseActive(): boolean {
  const provider = (process.env.DB_PROVIDER || 'auto').trim().toLowerCase();
  if (provider === 'mongo') {
    return false;
  }

  const hasUrl = Boolean(process.env.SUPABASE_URL?.trim());
  const hasKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim()
  );

  if (provider === 'supabase') {
    return hasUrl && hasKey;
  }

  // 'auto': activate Supabase in dev/prod when configured, while keeping existing
  // MongoDB test suites isolated unless DB_PROVIDER=supabase is explicitly requested.
  if (isNodeTestRunner()) {
    return false;
  }
  return hasUrl && hasKey;
}

export function generateHex24Id(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function isHex24(val: unknown): val is string {
  return typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val.trim());
}

export function toHex24(val: unknown): string {
  if (!val) return generateHex24Id();
  if (typeof val === 'object' && val !== null && 'toHexString' in val) {
    return String((val as { toHexString: () => string }).toHexString()).toLowerCase();
  }
  const str = String(val).trim().toLowerCase();
  if (/^[0-9a-f]{24}$/.test(str)) {
    return str;
  }
  const pgMatch = /^c0000000-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/.exec(str);
  if (pgMatch) {
    return `${pgMatch[1]}${pgMatch[2]}${pgMatch[3]}${pgMatch[4]}`;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(str)) {
    return str.replace(/-/g, '').slice(0, 24);
  }
  return str;
}

export function toPgUuid(idOrHex: unknown): string {
  const str = typeof idOrHex === 'object' && idOrHex !== null ? String(idOrHex) : String(idOrHex || '');
  const clean = str.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
    return clean;
  }
  if (/^[0-9a-f]{24}$/.test(clean)) {
    return `${SUPABASE_UUID_HEX24_PREFIX}-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 24)}`;
  }
  const generated = generateHex24Id();
  return `${SUPABASE_UUID_HEX24_PREFIX}-${generated.slice(0, 4)}-${generated.slice(4, 8)}-${generated.slice(8, 12)}-${generated.slice(12, 24)}`;
}

export function fromPgUuid(uuid: string | null | undefined): string {
  if (!uuid) return generateHex24Id();
  const clean = uuid.trim().toLowerCase();
  const match = /^c0000000-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/.exec(clean);
  if (match) {
    return `${match[1]}${match[2]}${match[3]}${match[4]}`;
  }
  return clean.replace(/-/g, '').slice(0, 24);
}

export function getSupabase(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY in environment variables.');
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

export function initSupabase(): SupabaseClient {
  const client = getSupabase();
  return client;
}

export async function pingSupabase(): Promise<boolean> {
  try {
    const client = getSupabase();
    const { error } = await client.from('users').select('id').limit(1);
    if (error) {
      supabaseConnected = false;
      console.error('[Supabase] Ping failed:', error.message);
      return false;
    }
    supabaseConnected = true;
    return true;
  } catch (err) {
    supabaseConnected = false;
    console.error('[Supabase] Ping exception:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

export function isSupabaseConnected(): boolean {
  return supabaseConnected;
}

export async function disconnectSupabase(): Promise<void> {
  supabaseConnected = false;
  supabaseClient = null;
}
