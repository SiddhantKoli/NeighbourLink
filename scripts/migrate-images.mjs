import { randomUUID } from 'node:crypto';
import { openDatabase } from '../database.mjs';
import { createObjectStorage, validateImage } from '../storage.mjs';

const apply = process.argv.includes('--apply');
const db = await openDatabase();
const storage = await createObjectStorage();
let migrated = 0;
let skipped = 0;
const rows = [
  ...(await db('SELECT id,profile_photo AS photo FROM users WHERE profile_photo IS NOT NULL AND profile_photo_key IS NULL')).rows.map(row => ({...row,kind:'profile'})),
  ...(await db('SELECT id,photo FROM listings WHERE photo IS NOT NULL AND photo_key IS NULL')).rows.map(row => ({...row,kind:'listing'}))
];
console.log(`${apply ? 'Applying' : 'Dry run:'} ${rows.length} legacy image(s) found.`);
for (const row of rows) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(row.photo || '');
  if (!match) { skipped++; console.warn(`Skipping ${row.kind} ${row.id}: unsupported or malformed image data.`); continue; }
  const bytes = Buffer.from(match[2], 'base64');
  try { validateImage(bytes, match[1]); }
  catch { skipped++; console.warn(`Skipping ${row.kind} ${row.id}: invalid image or image exceeds 1 MB.`); continue; }
  if (!apply) { console.log(`Would migrate ${row.kind} ${row.id} (${bytes.length} bytes).`); continue; }
  const key = `${row.kind}/${row.id}/${randomUUID()}`;
  await storage.put(key, bytes, match[1]);
  const stored = await storage.get(key);
  if (!stored || !stored.bytes.equals(bytes) || stored.contentType !== match[1]) {
    await storage.remove(key).catch(() => {});
    throw new Error(`Storage verification failed for ${row.kind} ${row.id}; database source remains intact.`);
  }
  const table = row.kind === 'profile' ? 'users' : 'listings';
  const keyColumn = row.kind === 'profile' ? 'profile_photo_key' : 'photo_key';
  const result = await db(`UPDATE ${table} SET ${keyColumn}=?,${row.kind === 'profile' ? 'profile_photo' : 'photo'}=NULL WHERE id=? AND ${keyColumn} IS NULL`,key,row.id);
  if (!result.changes) { await storage.remove(key); skipped++; continue; }
  migrated++;
}
console.log(`${apply ? `Migrated ${migrated}` : 'Dry run complete'}; skipped ${skipped}.`);
if (!apply && rows.length) console.log('Back up the database, configure object storage, then rerun with --apply.');
