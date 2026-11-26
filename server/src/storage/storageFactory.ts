import type { IStorageProvider } from './storageProvider.interface.js';
import { S3StorageProvider } from './s3StorageProvider.js';
import { SupabaseStorageProvider } from './supabaseStorageProvider.js';
import { LocalStorageProvider } from './localStorageProvider.js';
import { MemoryStorageProvider } from './memoryStorageProvider.js';
import { isSupabaseActive } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

let defaultStorageProvider: IStorageProvider | null = null;

export function getStorageProvider(): IStorageProvider {
  if (defaultStorageProvider) {
    return defaultStorageProvider;
  }

  const rawProvider = env.STORAGE_PROVIDER;
  const providerType =
    rawProvider === 'auto'
      ? env.ENABLE_FILE_SHARING === false
        ? 'disabled'
        : isSupabaseActive() && !env.STORAGE_S3_ACCESS_KEY_ID && !env.STORAGE_S3_ENDPOINT
          ? 'supabase'
          : env.NODE_ENV === 'production'
            ? 's3'
            : 'local'
      : rawProvider;

  if (providerType === 'disabled') {
    throw new AppError(
      'File storage is disabled (STORAGE_PROVIDER=disabled / ENABLE_FILE_SHARING=false).',
      503,
      'STORAGE_DISABLED'
    );
  }

  if (providerType === 'supabase') {
    defaultStorageProvider = new SupabaseStorageProvider({
      bucket: env.SUPABASE_STORAGE_BUCKET,
      maxFileSizeBytes: env.STORAGE_MAX_FILE_SIZE_BYTES,
    });
    return defaultStorageProvider;
  }

  if (providerType === 's3') {
    defaultStorageProvider = new S3StorageProvider({
      bucket: env.STORAGE_S3_BUCKET,
      region: env.STORAGE_S3_REGION,
      endpoint: env.STORAGE_S3_ENDPOINT || undefined,
      accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY || undefined,
      forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
      maxFileSizeBytes: env.STORAGE_MAX_FILE_SIZE_BYTES,
    });
    return defaultStorageProvider;
  }

  if (providerType === 'local') {
    if (env.NODE_ENV === 'production') {
      throw new AppError(
        'CRITICAL: Local storage is prohibited in production. Configure STORAGE_PROVIDER=s3.',
        500,
        'LOCAL_STORAGE_PROHIBITED_IN_PROD'
      );
    }
    defaultStorageProvider = new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
    return defaultStorageProvider;
  }

  if (providerType === 'memory') {
    if (env.NODE_ENV === 'production') {
      throw new AppError(
        'CRITICAL: Memory storage is prohibited in production. Configure STORAGE_PROVIDER=s3.',
        500,
        'MEMORY_STORAGE_PROHIBITED_IN_PROD'
      );
    }
    defaultStorageProvider = new MemoryStorageProvider();
    return defaultStorageProvider;
  }

  throw new AppError(`Unknown storage provider: ${providerType}`, 500, 'INVALID_STORAGE_PROVIDER');
}

/**
 * Overrides the active storage provider (used in testing).
 */
export function setStorageProvider(customProvider: IStorageProvider | null): void {
  defaultStorageProvider = customProvider;
}
