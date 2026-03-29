/**
 * Borealis Beacon - SQLite Database
 *
 * Persists BTS key claims, Forge purchases, email nurture queue, and IP rate limits.
 * Uses WAL mode for concurrent read safety.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'beacon.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS beacon_keys (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      bts_key      TEXT NOT NULL,
      key_hash     TEXT NOT NULL,
      scan_id      TEXT,
      scanned_url  TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      confirm_token TEXT,
      ip           TEXT,
      created_at   INTEGER NOT NULL,
      confirmed_at INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_beacon_keys_email
      ON beacon_keys(email);
    CREATE INDEX IF NOT EXISTS idx_beacon_keys_token
      ON beacon_keys(confirm_token)
      WHERE confirm_token IS NOT NULL;

    CREATE TABLE IF NOT EXISTS forge_purchases (
      receipt_id        TEXT PRIMARY KEY,
      scan_id           TEXT NOT NULL,
      issue_index       INTEGER NOT NULL,
      issue_title       TEXT,
      issue_dimension   TEXT,
      email             TEXT,
      stripe_session_id TEXT UNIQUE,
      scanned_url       TEXT,
      page_title        TEXT,
      page_description  TEXT,
      generated_schema  TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        INTEGER NOT NULL,
      completed_at      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_forge_stripe
      ON forge_purchases(stripe_session_id)
      WHERE stripe_session_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS email_nurture (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      scan_id     TEXT,
      key_id      TEXT,
      scan_score  INTEGER,
      weakest_dim TEXT,
      enrolled_at INTEGER NOT NULL,
      day3_sent   INTEGER,
      day7_sent   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_nurture_pending
      ON email_nurture(enrolled_at)
      WHERE day3_sent IS NULL OR day7_sent IS NULL;

    CREATE TABLE IF NOT EXISTS ip_claim_log (
      ip          TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ip_claim_log ON ip_claim_log(ip, created_at);
  `);
}

// ─── Rate limit helpers ────────────────────────────────────────────────────────

export function countIpClaims(ip: string, windowMs: number): number {
  const db = getDb();
  const since = Date.now() - windowMs;
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM ip_claim_log WHERE ip = ? AND created_at > ?'
  ).get(ip, since) as { cnt: number };
  return row?.cnt ?? 0;
}

export function logIpClaim(ip: string): void {
  getDb().prepare('INSERT INTO ip_claim_log (ip, created_at) VALUES (?, ?)').run(ip, Date.now());
}

// ─── Key claim helpers ─────────────────────────────────────────────────────────

export interface BeaconKey {
  id: string;
  email: string;
  bts_key: string;
  key_hash: string;
  scan_id: string | null;
  scanned_url: string | null;
  status: string;
  confirm_token: string | null;
  ip: string | null;
  created_at: number;
  confirmed_at: number | null;
}

export function findKeyByEmail(email: string): BeaconKey | null {
  return getDb().prepare('SELECT * FROM beacon_keys WHERE email = ?').get(email) as BeaconKey | null;
}

export function findKeyByToken(token: string): BeaconKey | null {
  return getDb().prepare('SELECT * FROM beacon_keys WHERE confirm_token = ?').get(token) as BeaconKey | null;
}

export function insertBeaconKey(key: Omit<BeaconKey, 'confirmed_at'>): void {
  getDb().prepare(`
    INSERT INTO beacon_keys
      (id, email, bts_key, key_hash, scan_id, scanned_url, status, confirm_token, ip, created_at)
    VALUES
      (@id, @email, @bts_key, @key_hash, @scan_id, @scanned_url, @status, @confirm_token, @ip, @created_at)
  `).run(key);
}

export function activateBeaconKey(token: string): BeaconKey | null {
  const db = getDb();
  const key = findKeyByToken(token);
  if (!key || key.status !== 'pending') return null;
  db.prepare(
    'UPDATE beacon_keys SET status = ?, confirmed_at = ?, confirm_token = NULL WHERE id = ?'
  ).run('active', Date.now(), key.id);
  return { ...key, status: 'active', confirmed_at: Date.now() };
}

// ─── Forge purchase helpers ────────────────────────────────────────────────────

export interface ForgePurchase {
  receipt_id: string;
  scan_id: string;
  issue_index: number;
  issue_title: string | null;
  issue_dimension: string | null;
  email: string | null;
  stripe_session_id: string | null;
  scanned_url: string | null;
  page_title: string | null;
  page_description: string | null;
  generated_schema: string | null;
  status: string;
  created_at: number;
  completed_at: number | null;
}

export function insertForgePurchase(purchase: Omit<ForgePurchase, 'generated_schema' | 'completed_at'>): void {
  getDb().prepare(`
    INSERT INTO forge_purchases
      (receipt_id, scan_id, issue_index, issue_title, issue_dimension, email,
       stripe_session_id, scanned_url, page_title, page_description, status, created_at)
    VALUES
      (@receipt_id, @scan_id, @issue_index, @issue_title, @issue_dimension, @email,
       @stripe_session_id, @scanned_url, @page_title, @page_description, @status, @created_at)
  `).run(purchase);
}

export function completeForgePurchase(stripeSessionId: string, schema: string): ForgePurchase | null {
  const db = getDb();
  const p = db.prepare('SELECT * FROM forge_purchases WHERE stripe_session_id = ?').get(stripeSessionId) as ForgePurchase | null;
  if (!p) return null;
  db.prepare(
    'UPDATE forge_purchases SET generated_schema = ?, status = ?, completed_at = ? WHERE receipt_id = ?'
  ).run(schema, 'completed', Date.now(), p.receipt_id);
  return { ...p, generated_schema: schema, status: 'completed', completed_at: Date.now() };
}

export function getForgePurchase(receiptId: string): ForgePurchase | null {
  return getDb().prepare('SELECT * FROM forge_purchases WHERE receipt_id = ?').get(receiptId) as ForgePurchase | null;
}

// ─── Email nurture helpers ─────────────────────────────────────────────────────

export function enrollInNurture(id: string, email: string, scanId: string | null, keyId: string, scanScore: number | null, weakestDim: string | null): void {
  const existing = getDb().prepare('SELECT id FROM email_nurture WHERE email = ?').get(email);
  if (existing) return; // already enrolled
  getDb().prepare(`
    INSERT INTO email_nurture (id, email, scan_id, key_id, scan_score, weakest_dim, enrolled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, scanId, keyId, scanScore, weakestDim, Date.now());
}

export function getNurturePendingDay3(): Array<{ id: string; email: string; scan_score: number | null; weakest_dim: string | null; scan_id: string | null }> {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return getDb().prepare(
    'SELECT id, email, scan_score, weakest_dim, scan_id FROM email_nurture WHERE day3_sent IS NULL AND enrolled_at <= ?'
  ).all(threeDaysAgo) as Array<{ id: string; email: string; scan_score: number | null; weakest_dim: string | null; scan_id: string | null }>;
}

export function getNurturePendingDay7(): Array<{ id: string; email: string; scan_score: number | null }> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return getDb().prepare(
    'SELECT id, email, scan_score FROM email_nurture WHERE day3_sent IS NOT NULL AND day7_sent IS NULL AND enrolled_at <= ?'
  ).all(sevenDaysAgo) as Array<{ id: string; email: string; scan_score: number | null }>;
}

export function markNurtureDay3Sent(id: string): void {
  getDb().prepare('UPDATE email_nurture SET day3_sent = ? WHERE id = ?').run(Date.now(), id);
}

export function markNurtureDay7Sent(id: string): void {
  getDb().prepare('UPDATE email_nurture SET day7_sent = ? WHERE id = ?').run(Date.now(), id);
}
