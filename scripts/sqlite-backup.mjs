import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.DB_PATH || path.join(project, 'data', 'marketplace.sqlite');
if (source === ':memory:') throw new Error('A memory database cannot be backed up.');
const target = path.resolve(process.argv[2] || path.join(project, 'backups', `marketplace-${new Date().toISOString().replaceAll(':','-')}.sqlite`));
if (path.resolve(source) === target) throw new Error('Backup destination must differ from DB_PATH.');
mkdirSync(path.dirname(target), { recursive:true });
const db = new DatabaseSync(source);
try {
  const escaped = target.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escaped}'`);
} finally { db.close(); }
const check = new DatabaseSync(target, { readOnly:true });
try {
  const result = check.prepare('PRAGMA quick_check').get();
  if (result.quick_check !== 'ok') throw new Error('Backup integrity check failed: ' + result.quick_check);
} finally { check.close(); }
console.log(`Verified SQLite backup: ${target}`);
