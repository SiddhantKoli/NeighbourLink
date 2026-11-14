import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const schema = `
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, salt TEXT, password TEXT, phone TEXT, profile_photo TEXT);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, "user" INTEGER, expires BIGINT);
  CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY, owner INTEGER, kind TEXT, title TEXT, category TEXT, price INTEGER, area TEXT, description TEXT, photo TEXT, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS saved("user" INTEGER, listing INTEGER, PRIMARY KEY("user",listing));
  CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, listing INTEGER, requester INTEGER, status TEXT DEFAULT 'pending', start_date TEXT, end_date TEXT, details TEXT, UNIQUE(listing,requester));
  CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, request INTEGER, sender INTEGER, body TEXT, sent TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS demo_payments(booking INTEGER PRIMARY KEY, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL, updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ratings(booking INTEGER PRIMARY KEY, score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), comment TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, listing INTEGER, reporter INTEGER, reason TEXT, status TEXT DEFAULT 'open', UNIQUE(listing,reporter));
`;
const requestColumns = ['start_date','end_date','details','pickup_at','return_at','completed_at','accepted_at','agreed_price','is_gear'];
const listingColumns = ['latitude','longitude'];
const migrations = [
  {
    version: 1,
    name: 'baseline marketplace schema',
    async up(context) {
      await context.exec(schema);
      for (const column of ['phone','profile_photo']) await context.addColumn('users',column,'TEXT');
      for (const column of listingColumns) await context.addColumn('listings',column,'REAL');
      for (const column of requestColumns) await context.addColumn('requests',column,column === 'is_gear' ? 'INTEGER DEFAULT 0' : 'TEXT');
      if (context.dialect === 'postgres') {
        await context.exec('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions');
        await context.exec(`
          DO $migration$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'neighbourlink.requests'::regclass AND conname = 'requests_no_overlap_lifecycle') THEN
              ALTER TABLE requests ADD CONSTRAINT requests_no_overlap_lifecycle EXCLUDE USING gist
                (listing WITH =, int4range(replace(start_date,'-','')::int,replace(end_date,'-','')::int,'[]') WITH &&)
                WHERE (status IN ('accepted','active','returned','completed') AND start_date IS NOT NULL AND end_date IS NOT NULL AND is_gear = 1);
            END IF;
          END;
          $migration$;
        `);
      }
    }
  },
  {
    version: 2,
    name: 'verification, settings, audit and ledger',
    async up(context) {
      await context.addColumn('users','email_verified_at','TEXT');
      await context.query('UPDATE users SET email_verified_at=? WHERE email_verified_at IS NULL',new Date().toISOString());
      await context.exec(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens(
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS email_verification_tokens_user ON email_verification_tokens(user_id,created_at);
        CREATE TABLE IF NOT EXISTS password_reset_tokens(
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS password_reset_tokens_user ON password_reset_tokens(user_id,created_at);
        CREATE TABLE IF NOT EXISTS booking_status_audit(
          id INTEGER PRIMARY KEY, booking INTEGER NOT NULL, actor_user_id INTEGER, old_status TEXT NOT NULL,
          new_status TEXT NOT NULL, occurred_at TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS booking_status_audit_booking ON booking_status_audit(booking,id);
        CREATE TABLE IF NOT EXISTS money_ledger(
          id INTEGER PRIMARY KEY, booking INTEGER, event_type TEXT NOT NULL, amount_minor BIGINT NOT NULL,
          currency TEXT NOT NULL, provider TEXT, provider_reference TEXT, idempotency_key TEXT NOT NULL UNIQUE,
          actor_user_id INTEGER, metadata TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS money_ledger_booking ON money_ledger(booking,id);
        CREATE TABLE IF NOT EXISTS marketplace_settings(
          setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, description TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const now = new Date().toISOString();
      const defaults = [
        ['deposit_base_percent','25','Placeholder: base deposit as a percentage of item value.'],
        ['trust_multiplier_unverified','1.5','Placeholder: deposit multiplier for a new or unverified renter.'],
        ['trust_multiplier_trusted','1','Placeholder: deposit multiplier for a trusted renter.'],
        ['deposit_min_minor','50000','Placeholder: minimum deposit in minor currency units.'],
        ['deposit_max_minor','10000000','Placeholder: maximum deposit in minor currency units.'],
        ['commission_percent','10','Placeholder: platform commission percentage.'],
        ['claim_window_hours','24','Placeholder: time to raise a return claim.'],
        ['late_fee_per_day_minor','50000','Placeholder: late fee per day in minor currency units.']
      ];
      for (const [key,value,description] of defaults) {
        await context.query('INSERT INTO marketplace_settings(setting_key,setting_value,description,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO NOTHING',key,value,description,now);
      }
      if (context.dialect === 'sqlite') {
        await context.exec(`
          CREATE TRIGGER IF NOT EXISTS money_ledger_no_update BEFORE UPDATE ON money_ledger BEGIN SELECT RAISE(ABORT,'money_ledger is append-only'); END;
          CREATE TRIGGER IF NOT EXISTS money_ledger_no_delete BEFORE DELETE ON money_ledger BEGIN SELECT RAISE(ABORT,'money_ledger is append-only'); END;
          CREATE TRIGGER IF NOT EXISTS booking_status_audit_no_update BEFORE UPDATE ON booking_status_audit BEGIN SELECT RAISE(ABORT,'booking_status_audit is append-only'); END;
          CREATE TRIGGER IF NOT EXISTS booking_status_audit_no_delete BEFORE DELETE ON booking_status_audit BEGIN SELECT RAISE(ABORT,'booking_status_audit is append-only'); END;
        `);
      } else {
        await context.exec(`
          CREATE OR REPLACE FUNCTION prevent_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$;
          DROP TRIGGER IF EXISTS money_ledger_append_only ON money_ledger;
          CREATE TRIGGER money_ledger_append_only BEFORE UPDATE OR DELETE ON money_ledger FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
          DROP TRIGGER IF EXISTS booking_status_audit_append_only ON booking_status_audit;
          CREATE TRIGGER booking_status_audit_append_only BEFORE UPDATE OR DELETE ON booking_status_audit FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
        `);
      }
    }
  },
  {
    version: 3,
    name: 'object storage metadata and upload records',
    async up(context) {
      await context.addColumn('users','profile_photo_key','TEXT');
      await context.addColumn('listings','photo_key','TEXT');
      await context.exec(`
        CREATE TABLE IF NOT EXISTS uploads(
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, purpose TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
          content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS uploads_owner_created ON uploads(user_id,created_at);
        CREATE INDEX IF NOT EXISTS listings_photo_key ON listings(photo_key);
      `);
    }
  },
  {
    version: 4,
    name: 'phone verification, KYC, and rental trust foundation',
    async up(context) {
      await context.addColumn('users','phone_verified_at','TEXT');
      await context.addColumn('users','kyc_status',"TEXT NOT NULL DEFAULT 'unverified'");
      await context.addColumn('listings','item_value_minor','BIGINT');
      await context.exec(`
        CREATE TABLE IF NOT EXISTS phone_otp_challenges(
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, phone TEXT NOT NULL, code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS phone_otp_user_created ON phone_otp_challenges(user_id,created_at);
        CREATE TABLE IF NOT EXISTS kyc_cases(
          user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('unverified','verified','suspended')),
          id_storage_key TEXT, id_content_type TEXT, selfie_storage_key TEXT, selfie_content_type TEXT,
          provider TEXT NOT NULL DEFAULT 'manual', provider_reference TEXT, decision_reason TEXT,
          submitted_at TEXT, reviewed_at TEXT, reviewer_user_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS kyc_access_audit(
          id INTEGER PRIMARY KEY, reviewer_user_id INTEGER NOT NULL, subject_user_id INTEGER NOT NULL,
          document_kind TEXT NOT NULL, accessed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS kyc_access_subject_time ON kyc_access_audit(subject_user_id,accessed_at);
        CREATE TABLE IF NOT EXISTS kyc_review_audit(
          id INTEGER PRIMARY KEY, actor_user_id INTEGER NOT NULL, subject_user_id INTEGER NOT NULL,
          old_status TEXT NOT NULL, new_status TEXT NOT NULL, reason TEXT NOT NULL, occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS kyc_review_subject_time ON kyc_review_audit(subject_user_id,occurred_at);
      `);
      const now=new Date().toISOString();
      const defaults=[
        ['new_renter_max_item_value_minor','2000000','Placeholder: maximum item value for a new renter, in paise.'],
        ['established_renter_completed_rentals','3','Placeholder: completed rentals required to leave the new-renter tier.'],
        ['trust_score_minimum','65','Placeholder: minimum trust score before elevated item-value access.'],
        ['trust_score_maximum','100','Placeholder: upper bound for the explainable trust score.'],
        ['kyc_document_retention_days','90','Placeholder: days to retain identity documents after a review decision.']
      ];
      for (const [key,value,description] of defaults) {
        await context.query('INSERT INTO marketplace_settings(setting_key,setting_value,description,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO NOTHING',key,value,description,now);
      }
      const appendOnly=['kyc_access_audit','kyc_review_audit'];
      if (context.dialect === 'sqlite') {
        for (const table of appendOnly) {
          await context.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'${table} is append-only'); END;`);
          await context.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'${table} is append-only'); END;`);
        }
      } else {
        await context.exec(`
          CREATE OR REPLACE FUNCTION prevent_kyc_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$;
          DROP TRIGGER IF EXISTS kyc_access_audit_append_only ON kyc_access_audit;
          CREATE TRIGGER kyc_access_audit_append_only BEFORE UPDATE OR DELETE ON kyc_access_audit FOR EACH ROW EXECUTE FUNCTION prevent_kyc_audit_mutation();
          DROP TRIGGER IF EXISTS kyc_review_audit_append_only ON kyc_review_audit;
          CREATE TRIGGER kyc_review_audit_append_only BEFORE UPDATE OR DELETE ON kyc_review_audit FOR EACH ROW EXECUTE FUNCTION prevent_kyc_audit_mutation();
        `);
      }
    }
  },
  {
    version: 5,
    name: 'protected rentals, provider payments, evidence, and mutual reviews',
    async up(context) {
      await context.addColumn('listings','condition_checklist',"TEXT NOT NULL DEFAULT '[]'");
      await context.addColumn('listings','deposit_override_minor','BIGINT');
      await context.addColumn('requests','deposit_minor','BIGINT');
      await context.addColumn('requests','risk_multiplier','REAL');
      await context.addColumn('requests','claim_deadline','TEXT');
      await context.addColumn('requests','due_at','TEXT');
      await context.exec(`
        CREATE TABLE IF NOT EXISTS owner_payment_accounts(
          user_id INTEGER PRIMARY KEY, provider TEXT NOT NULL, account_id TEXT NOT NULL UNIQUE,
          verified_at TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS protected_payments(
          booking INTEGER PRIMARY KEY, provider TEXT NOT NULL, provider_order_id TEXT NOT NULL UNIQUE,
          provider_payment_id TEXT UNIQUE, payment_status TEXT NOT NULL, amount_minor BIGINT NOT NULL,
          rent_minor BIGINT NOT NULL, deposit_minor BIGINT NOT NULL, commission_minor BIGINT NOT NULL,
          rental_transfer_id TEXT, deposit_transfer_id TEXT, settlement_status TEXT NOT NULL DEFAULT 'open', settlement_started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS payment_webhook_events(
          event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS booking_evidence(
          id TEXT PRIMARY KEY, booking INTEGER NOT NULL, uploader_user_id INTEGER NOT NULL,
          phase TEXT NOT NULL CHECK(phase IN ('handover','return')), storage_key TEXT NOT NULL UNIQUE,
          content_type TEXT NOT NULL, uploaded_at TEXT NOT NULL, UNIQUE(booking,uploader_user_id,phase)
        );
        CREATE INDEX IF NOT EXISTS booking_evidence_booking_phase ON booking_evidence(booking,phase);
        CREATE TABLE IF NOT EXISTS booking_ratings(
          id INTEGER PRIMARY KEY, booking INTEGER NOT NULL, rater_user_id INTEGER NOT NULL,
          ratee_user_id INTEGER NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
          comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(booking,rater_user_id)
        );
        CREATE TABLE IF NOT EXISTS booking_late_fees(
          booking INTEGER PRIMARY KEY, amount_minor BIGINT NOT NULL, assessed_at TEXT NOT NULL,
          owner_transfer_id TEXT, status TEXT NOT NULL DEFAULT 'assessed'
        );
        CREATE TABLE IF NOT EXISTS booking_claims(
          booking INTEGER PRIMARY KEY, owner_user_id INTEGER NOT NULL, reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open', renter_response TEXT, created_at TEXT NOT NULL,
          responded_at TEXT, resolved_at TEXT, resolution TEXT, resolution_reason TEXT, resolver_user_id INTEGER
        );
      `);
      const now=new Date().toISOString();
      const defaults=[
        ['deposit_category_multiplier_default','1','Placeholder: default category risk multiplier.'],
        ['deposit_category_multiplier_tools','1.1','Placeholder: Tools category risk multiplier.'],
        ['deposit_category_multiplier_tech','1.2','Placeholder: Tech and Camera category risk multiplier.'],
        ['deposit_category_multiplier_outdoors','1.05','Placeholder: Outdoors category risk multiplier.'],
        ['deposit_duration_multiplier_7_days','1.1','Placeholder: additional multiplier for rentals longer than 7 days.'],
        ['deposit_long_duration_days','7','Placeholder: rental duration threshold that increases deposit risk.'],
        ['max_rental_days','30','Placeholder: maximum length for a single Gear rental.'],
        ['deposit_owner_override_max_percent','50','Placeholder: maximum bounded owner adjustment percentage.'],
        ['cancellation_free_hours','24','Placeholder: hours before pickup with no cancellation fee.'],
        ['late_fee_grace_hours','0','Placeholder: late-return grace hours.']
      ];
      for (const [key,value,description] of defaults) await context.query('INSERT INTO marketplace_settings(setting_key,setting_value,description,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO NOTHING',key,value,description,now);
      if (context.dialect==='sqlite') {
        await context.exec(`
          CREATE TRIGGER IF NOT EXISTS payment_webhook_events_no_update BEFORE UPDATE ON payment_webhook_events BEGIN SELECT RAISE(ABORT,'payment_webhook_events is append-only'); END;
          CREATE TRIGGER IF NOT EXISTS payment_webhook_events_no_delete BEFORE DELETE ON payment_webhook_events BEGIN SELECT RAISE(ABORT,'payment_webhook_events is append-only'); END;
          CREATE TRIGGER IF NOT EXISTS booking_evidence_no_update BEFORE UPDATE ON booking_evidence BEGIN SELECT RAISE(ABORT,'booking_evidence is immutable'); END;
          CREATE TRIGGER IF NOT EXISTS booking_evidence_no_delete BEFORE DELETE ON booking_evidence BEGIN SELECT RAISE(ABORT,'booking_evidence is immutable'); END;
        `);
      } else {
        await context.exec(`
          CREATE OR REPLACE FUNCTION prevent_protected_rental_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME; END; $$;
          DROP TRIGGER IF EXISTS payment_webhook_events_append_only ON payment_webhook_events;
          CREATE TRIGGER payment_webhook_events_append_only BEFORE UPDATE OR DELETE ON payment_webhook_events FOR EACH ROW EXECUTE FUNCTION prevent_protected_rental_mutation();
          DROP TRIGGER IF EXISTS booking_evidence_immutable ON booking_evidence;
          CREATE TRIGGER booking_evidence_immutable BEFORE UPDATE OR DELETE ON booking_evidence FOR EACH ROW EXECUTE FUNCTION prevent_protected_rental_mutation();
        `);
      }
    }
  }
];

function sqliteExecutor(db) {
  const execute = async (sql,...args) => {
    const statement = db.prepare(sql);
    if (statement.columns().length) return { rows:statement.all(...args) };
    return { changes:statement.run(...args).changes };
  };
  execute.transaction = async action => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = await action(execute); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return execute;
}

function postgresExecutor(client,pool) {
  const execute = async (sql,...args) => {
    let index = 0;
    const qualified = sql.replace(/\b(FROM|JOIN|INTO|UPDATE|TABLE) (users|sessions|listings|saved|requests|messages|reports|ratings|demo_payments|email_verification_tokens|password_reset_tokens|booking_status_audit|money_ledger|marketplace_settings|uploads|schema_migrations|phone_otp_challenges|kyc_cases|kyc_access_audit|kyc_review_audit|owner_payment_accounts|protected_payments|payment_webhook_events|booking_evidence|booking_ratings|booking_late_fees|booking_claims)\b/g,'$1 neighbourlink.$2');
    const result = await client.query(qualified.replaceAll('?',() => '$' + ++index),args);
    return { rows:result.rows, changes:result.rowCount };
  };
  execute.exec = async sql => { await client.query(sql); return { changes:0 }; };
  execute.transaction = async action => {
    const transactionClient = await pool.connect();
    try {
      await transactionClient.query('BEGIN');
      await transactionClient.query('SET LOCAL search_path = neighbourlink, extensions, public');
      const result = await action(postgresExecutor(transactionClient,pool));
      await transactionClient.query('COMMIT');
      return result;
    } catch (error) { await transactionClient.query('ROLLBACK'); throw error; }
    finally { transactionClient.release(); }
  };
  return execute;
}

async function migrate({dialect,exec,query,hasColumn,transaction}) {
  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)`);
  for (const migration of migrations) {
    const existing = await query('SELECT version FROM schema_migrations WHERE version=?',migration.version);
    if (existing.rows.length) continue;
    await transaction(async contextExec => {
      const context = {
        dialect,
        exec:contextExec.exec || contextExec,
        query:contextExec,
        addColumn:async (table,column,type) => {
          if (!(await hasColumn(table,column,context.query))) {
            await context.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
          }
        }
      };
      await migration.up(context);
      await context.query('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)',migration.version,migration.name,new Date().toISOString());
    });
  }
}

export async function openDatabase() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const connection = new URL(process.env.DATABASE_URL);
    connection.searchParams.delete('sslmode');
    const certificate = process.env.SUPABASE_CA_CERT;
    const ssl = certificate ? { ca:readFileSync(certificate,'utf8'), rejectUnauthorized:true } : { rejectUnauthorized:true };
    const pool = new Pool({ connectionString:connection.href,ssl,connectionTimeoutMillis:10000 });
    pool.on('error',error => console.error('Database connection lost:',error.code));
    await pool.query('CREATE SCHEMA IF NOT EXISTS neighbourlink; REVOKE ALL ON SCHEMA neighbourlink FROM PUBLIC;');
    const query = postgresExecutor(pool,pool);
    query.exec = async sql => {
      const client = await pool.connect();
      try { await client.query('SET search_path = neighbourlink, extensions, public'); await client.query(sql); return { changes:0 }; }
      finally { client.release(); }
    };
    const hasColumn = async (table,column,exec=query) => (await exec('SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?','neighbourlink',table,column)).rows.length > 0;
    await migrate({dialect:'postgres',exec:query.exec,query,hasColumn,transaction:query.transaction});
    return query;
  }

  const directory = new URL('./data/',import.meta.url);
  mkdirSync(directory,{recursive:true});
  const db = new DatabaseSync(process.env.DB_PATH || fileURLToPath(new URL('marketplace.sqlite',directory)));
  db.exec('PRAGMA journal_mode=WAL;');
  const query = sqliteExecutor(db);
  query.exec = async sql => { db.exec(sql); return { changes:0 }; };
  const hasColumn = async (table,column) => db.prepare('PRAGMA table_info(' + table + ')').all().some(row => row.name === column);
  await migrate({dialect:'sqlite',exec:query.exec,query,hasColumn,transaction:query.transaction});
  return query;
}
