# NeighbourLink

NeighbourLink is a neighbourhood rental marketplace built with Node.js 24, a plain HTML/CSS/JavaScript client, and one versioned JSON API under `/api/v1`. It runs on SQLite locally or PostgreSQL on Supabase. The same API is intended to support a future desktop client.

## Run locally on Windows

1. Install Node.js 24 or newer.
2. In PowerShell, from this folder, run `npm ci`.
3. Copy `.env.example` to `.env` if you want to configure email, S3, or Supabase. SQLite and private local image storage work without `.env`.
4. Run `npm start` and open [http://127.0.0.1:8767](http://127.0.0.1:8767).
5. Run `npm test` for the isolated integration and migration tests.

Set `PORT` and `HOST` to change the listener, and `DB_PATH` to select a different SQLite file. The default database is `data/marketplace.sqlite`; local uploaded images are stored in `data/object-storage`. Keep both directories on persistent storage.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Optional PostgreSQL/Supabase connection string. Leave empty for SQLite. |
| `PUBLIC_ORIGIN` | Exact public site origin used to build verification and recovery links. |
| `EMAIL_PROVIDER` | `resend` for delivery, or `mock` in tests only. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend server-side credentials and verified sender. Never put these in browser code or commit `.env`. |
| `OBJECT_STORAGE_MODE` | `local` for development, `s3` for production, or `memory` in tests only. |
| `OBJECT_STORAGE_DIR` | Local private image directory. |
| `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION` | Required for S3-compatible storage. |
| `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_PATH_STYLE` | Optional S3-compatible endpoint settings. |
| `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Optional explicit S3 credentials; otherwise the AWS SDK credential chain is used. |
| `OBJECT_STORAGE_SSE` | Optional server-side encryption setting supported by the bucket. |
| `SMS_PROVIDER` | `twilio` for phone OTP delivery; the mock provider is limited to tests or explicit local development. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Server-side Twilio credentials and sender for phone verification. |
| `ALLOW_DEV_OTP` | Set to `1` only with `NODE_ENV=development` and `SMS_PROVIDER=mock` to display a local-only OTP. Never enable in production. |
| `KYC_ENCRYPTION_KEY` | Random 32-byte key encoded as 64 hex characters or base64. Required for government ID/selfie submissions; keep it separate from database and object-store backups. |
| `KYC_PROVIDER` | `manual` for the built-in admin-review adapter. External identity providers are not wired yet. |
| `DB_PATH` | SQLite database file. |
| `PORT`, `HOST` | HTTP listener settings. |

Email verification and password recovery require a configured Resend sender outside tests. Phone verification requires configured Twilio credentials; only local development with `NODE_ENV=development`, `SMS_PROVIDER=mock`, and `ALLOW_DEV_OTP=1` may display a test code. New photos are checked for JPEG, PNG, or WebP content and limited to 1 MB. Production should use a private S3-compatible bucket and configure server credentials. Do not expose the bucket publicly; image reads pass through the authenticated application.

On Windows, generate the KYC encryption key in PowerShell with `$bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); [BitConverter]::ToString($bytes).Replace('-', '')`, then put the result in `.env`. Back up this key separately and restrict access; losing it makes previously stored identity images unreadable.

## Supabase PostgreSQL

Set `DATABASE_URL` to the project's server-side Session pooler connection string in the ignored `.env` file. Supabase publishable keys are not database credentials and are not needed by the browser; the website talks to this server API. The server creates its tables in the private `neighbourlink` schema and requires TLS certificate verification. `SUPABASE_CA_CERT` can point to a trusted CA bundle when required by the deployment environment. Existing SQLite records are not copied to PostgreSQL automatically.

## Migrations, settings, and data safety

Database changes run as ordered, transactional migrations recorded in `schema_migrations`. New marketplace values are seeded into `marketplace_settings`; current values are placeholders and must be validated with real users before commercial use. Booking status changes are recorded in append-only `booking_status_audit`; money events are recorded in append-only `money_ledger`. The old demo checkout remains a demonstration flow until the protected-rental payment phase replaces it with a provider test-mode adapter. Never treat demo checkout as a real payment.

### SQLite backup and restore

Create a consistent SQLite backup while the app is running:

```powershell
npm run backup:sqlite
# Or choose the destination:
npm run backup:sqlite -- .\backups\before-change.sqlite
```

The command uses SQLite's online `VACUUM INTO` and checks the backup. To restore, stop the app, keep a copy of the current `data` directory, then copy the verified backup over the database path configured by `DB_PATH` (by default `data\marketplace.sqlite`). Start the app and run `npm test`; keep the corresponding object-storage backup too, because database rows refer to stored image objects. For Supabase, use the project's managed backups/PITR and practice restoring into a separate project before relying on it.

### Move legacy base64 photos to object storage

Back up the database first and configure the destination object storage. Preview the rows with `node scripts/migrate-images.mjs`; then explicitly apply with `node scripts/migrate-images.mjs --apply`. Each object is read back and verified before the database's base64 field is cleared. The script skips malformed or over-limit legacy images and is safe to rerun. Back up both the database and bucket before migration.

## CI and deployment

GitHub Actions runs `npm ci` and `npm test` on Node.js 24 for pushes and pull requests. For a pilot, use one application instance with persistent storage behind an HTTPS reverse proxy. Set `PUBLIC_ORIGIN` to the exact HTTPS origin and `COOKIE_SECURE=1`. Provision the moderation account with `ADMIN_EMAIL` and `ADMIN_SIGNUP_CODE` before opening registration, then remove the setup code. Keep provider credentials server-side, add monitoring, and verify database and object-store restore procedures before public launch.

The browser and a future desktop app can use the same versioned API. For an Electron client, use a hosted HTTPS origin with context isolation and sandboxing enabled and Node integration disabled. Authorization remains on the server.

## Marketplace features

- Separate Gear and Hire portals, with owner listing photos and neighbourhood text search.
- Listings can be saved, reported, and requested with rental dates or a preferred service date.
- Owners approve requests; participants have a private conversation and can leave a rating after completion.
- Account creation requires email verification and a complete profile with a validated phone number and profile photo.
- Phone numbers are verified using single-use, rate-limited SMS codes. Gear listings include item value; new renters are limited to lower-value items until they build rental history and ratings.
- Optional government ID and selfie review uses encrypted image storage, restricted admin access, reviewer decision states, and an access audit. Reviewed documents are removed after the settings-driven retention period (currently a 90-day placeholder); pending reviews remain available until decided. NeighbourLink does not ask for Aadhaar numbers.
- Password recovery uses single-use, expiring email links.
- Admin reports and booking history are available to authorized accounts.
- Example photos are illustrative only; member listings use the photo uploaded by the owner.

## Scope and release gates

The current release remains a marketplace pilot, not a production payment or escrow service. Next roadmap phases add verified phone/KYC trust, protected rentals and provider test-mode payments, disputes, availability/search, notifications, and business accounts. Money must never be held by NeighbourLink. Payment, deposit, claim-window, and fee settings are placeholders until validated with real users and reviewed for applicable law.

The supplied Phase 5 checklist ends at “Subscription plans”; provide the remaining bullets before that phase is scoped.
