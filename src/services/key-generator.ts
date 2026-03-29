/**
 * Borealis BTS Key Generator
 *
 * Replicates the key generation logic from borealismark-api.
 * Format: BTS-XXXX-XXXX-XXXX-XXXX
 * Charset excludes 0/O/1/I to avoid visual confusion.
 */

import crypto from 'crypto';

const KEY_PREFIX = 'BTS';
const KEY_SEGMENTS = 4;
const SEGMENT_LENGTH = 4;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateBTSKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const segments: string[] = [];
  for (let s = 0; s < KEY_SEGMENTS; s++) {
    let segment = '';
    const bytes = crypto.randomBytes(SEGMENT_LENGTH * 4); // generous entropy
    for (let i = 0; i < SEGMENT_LENGTH; i++) {
      // Use modulo bias mitigation
      const val = bytes.readUInt32BE(i * 4);
      segment += CHARSET[val % CHARSET.length];
    }
    segments.push(segment);
  }
  const rawKey = `${KEY_PREFIX}-${segments.join('-')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = `${KEY_PREFIX}-${segments[0]}`;
  return { rawKey, keyHash, keyPrefix };
}

export function generateConfirmToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateReceiptId(): string {
  return `forge_${crypto.randomBytes(16).toString('hex')}`;
}
