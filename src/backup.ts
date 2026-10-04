// Creates a consistent copy of the live database using SQLite's online backup API.
// Safe to run while the app is serving requests.
//   node dist/backup.js /data/backups/qr-20260101-120000.db
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const source = process.env.DATABASE_PATH || '/data/qr.db';
const target = process.argv[2];
if (!target) {
  console.error('Usage: node dist/backup.js <target-file>');
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
const db = new Database(source, { fileMustExist: true });
try {
  await db.backup(target);
  const check = new Database(target);
  // Make the backup a single self-contained file (no -wal/-shm side files).
  check.pragma('journal_mode = DELETE');
  const result = check.pragma('integrity_check', { simple: true });
  const links = check.prepare('SELECT COUNT(*) FROM links').pluck().get();
  check.close();
  if (result !== 'ok') throw new Error(`Integrity check failed: ${result}`);
  console.log(`Backup written to ${target} (${links} links).`);
} finally {
  db.close();
}
