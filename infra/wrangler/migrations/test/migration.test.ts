/**
 * Verifies 0001_init.sql is valid SQL D1 (SQLite) can apply.
 *
 * Spawns Node's built-in node:sqlite in-memory, runs the file, and
 * asserts the expected tables exist. CI catches typos and broken
 * FK / CHECK declarations before they hit a real D1.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

const require = createRequire(import.meta.url);
// node:sqlite is built into Node 22+; bypass Vite's resolver via require().
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncT };

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', '0001_init.sql');

function open(): DatabaseSyncT {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

const sql0002Path = join(__dirname, '..', '0002_api_keys.sql');

function applyAll(db: DatabaseSyncT) {
  db.exec(readFileSync(sqlPath, 'utf-8'));
  db.exec(readFileSync(sql0002Path, 'utf-8'));
}

describe('migrations', () => {
  it('0002 applies on top of 0001', () => {
    const db = open();
    applyAll(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toContain('api_keys');
  });
});

describe('0001_init.sql', () => {
  it('applies cleanly on an in-memory SQLite', () => {
    const db = open();
    const sql = readFileSync(sqlPath, 'utf-8');
    db.exec(sql);

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tables = new Set(rows.map((r) => r.name));
    for (const expected of [
      'users',
      'webauthn_credentials',
      'oauth_identities',
      'follows',
      'activities',
      'activity_metrics',
      'activity_streams',
      'segments',
      'segment_efforts',
      'kudos',
      'comments',
      'clubs',
      'club_members',
      'routes',
      'events',
      'event_invites',
      'pmc_daily',
      'notifications',
    ]) {
      expect(tables.has(expected), `expected table ${expected}`).toBe(true);
    }
  });

  it('enforces unique handle and email', () => {
    const db = open();
    db.exec(readFileSync(sqlPath, 'utf-8'));
    db.prepare("INSERT INTO users (id, handle, email) VALUES ('u1','alice','a@example.com')").run();
    expect(() =>
      db
        .prepare("INSERT INTO users (id, handle, email) VALUES ('u2','alice','b@example.com')")
        .run(),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO users (id, handle, email) VALUES ('u3','bob','a@example.com')").run(),
    ).toThrow();
  });

  it('rejects self-follows via CHECK', () => {
    const db = open();
    db.exec(readFileSync(sqlPath, 'utf-8'));
    db.prepare("INSERT INTO users (id, handle, email) VALUES ('u1','alice','a@example.com')").run();
    expect(() =>
      db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES ('u1','u1')").run(),
    ).toThrow();
  });
});
