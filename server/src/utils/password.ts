import argon2 from '@node-rs/argon2';
import { env } from '../config/env.js';

export const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$xkKmueoQBBlHl1Zy/owOXQ$RdmPmRRferJkfB1mBWTXGErJSAOmALCJczYg0Dpss3M';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch (error) {
    console.error('[Security] Password verification error:', error);
    return false;
  }
}

/**
 * Executes an Argon2 verification against a precomputed dummy hash.
 * Used when a user is not found to prevent account enumeration via timing analysis.
 */
export async function verifyDummyPassword(password: string = 'dummy_password_timing_defense'): Promise<boolean> {
  return verifyPassword(password || 'dummy_password_timing_defense', DUMMY_ARGON2_HASH);
}
