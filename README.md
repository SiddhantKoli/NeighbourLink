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
| `EMAIL_PROVIDER` | `resend` for delivery, or `mock` in tests/local development only. |
| `ALLOW_DEV_EMAIL_OTP`, `EMAIL_OTP_DEV_CODE` | With `NODE_ENV=development` and `EMAIL_PROVIDER=mock`, show the fixed local email code after signup or resend. |
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
| `PHONE_OTP_DEV_CODE` | Optional fixed six-digit phone code for that local development mode. |
| `KYC_ENCRYPTION_KEY` | Random 32-byte key encoded as 64 hex characters or base64. Required for government ID/selfie and business-registration document uploads; keep it separate from database and object-store backups. |
| `KYC_PROVIDER` | `manual` for the built-in admin-review adapter. External identity providers are not wired yet. |
| `PAYMENT_PROVIDER` | `razorpay` enables the TEST-mode payment adapter. Leave unset to disable checkout; `mock` is test-suite only. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Server-side Razorpay TEST API credentials. The app rejects live keys. |
| `RAZORPAY_WEBHOOK_SECRET` | TEST webhook signing secret configured for `/api/v1/webhooks/razorpay`. |
| `RAZORPAY_SHOP_PLAN_ID` | Razorpay TEST subscription plan ID used for paid shop subscriptions. Leave unset to keep paid plans disabled. |
| `DB_PATH` | SQLite database file. |
| `PORT`, `HOST` | HTTP listener settings. |

Email verification sends a six-digit code that expires in 10 minutes; password recovery sends a single-use link. Both require a configured Resend sender outside tests. For local development only, a fixed email code is available when `NODE_ENV=development`, `EMAIL_PROVIDER=mock`, and `ALLOW_DEV_EMAIL_OTP=1`; set `EMAIL_OTP_DEV_CODE` (default `123456`). Never enable this option in production. Phone verification requires configured Twilio credentials; only local development with `NODE_ENV=development`, `SMS_PROVIDER=mock`, and `ALLOW_DEV_OTP=1` may display a test code. New photos are checked for JPEG, PNG, or WebP content and limited to 1 MB. Production should use a private S3-compatible bucket and configure server credentials. Do not expose the bucket publicly; image reads pass through the authenticated application.

The seller dashboard summarizes listing activity, ledger-recorded releases, held amounts, and estimated release dates. Estimates are not a bank payout promise. Owners can block gear listing dates; search supports category, price, date availability, owner rating, and distance when the member chooses to share their location. Transactional email is queued with retry and deduplication; configure the same Resend settings described above. Terms, privacy, cancellation/refund, and banned-item pages are published as drafts for lawyer review, not final legal advice.

### Razorpay TEST payments

Gear checkout is disabled until `PAYMENT_PROVIDER=razorpay`, Razorpay TEST keys, and a webhook secret are configured. The payment adapter rejects live keys. Razorpay Route must separately approve the marketplace use case and activate each seller's linked account; sellers then connect that account ID in their booking conversation. Checkout sends the rental and refundable deposit as separate settlement-on-hold transfers to the seller's linked account. The platform retains only its configured commission. A Route settlement hold is a provider timing control, not escrow or a guarantee of reimbursement. After the claim window, the app releases the rental transfer, reverses the deposit transfer, routes any assessed late fee to the seller, and refunds the remaining deposit. Disputed deposits stay frozen for admin review. The admin can return the full deposit, release a bounded portion to the owner and return the rest, or release the entire deposit to the owner. Every decision and resulting provider movement is recorded in the claim audit and append-only money ledger. Use Razorpay's TEST dashboard/webhooks and keep all keys server-side.

For local development without provider access, `PAYMENT_PROVIDER` may remain unset and protected checkout displays as unavailable. The mock adapter is only enabled by the automated test suite; it cannot collect money or be used by a running development/production server.

Shop plans use a free Community tier and a paid Neighbourhood Plus tier. The displayed ₹499/month, listing limits, and quantity limits are placeholders, not validated prices. Paid checkout requires the Razorpay TEST API credentials above plus a TEST subscription plan ID in `RAZORPAY_SHOP_PLAN_ID`; subscribe the configured webhook to subscription activation, charge, halt, and cancellation events. Shop status changes come from signed provider webhooks, and captured subscription amounts enter the append-only money ledger. Owners can cancel through the provider adapter. With billing unavailable, the free tier still works and paid upgrades return an explicit setup message without charging.

On Windows, generate the KYC encryption key in PowerShell with `$bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); [BitConverter]::ToString($bytes).Replace('-', '')`, then put the result in `.env`. Back up this key separately and restrict access; losing it makes previously stored identity images unreadable.

## Supabase PostgreSQL

Set `DATABASE_URL` to the project's server-side Session pooler connection string in the ignored `.env` file. Supabase publishable keys are not database credentials and are not needed by the browser; the website talks to this server API. The server creates its tables in the private `neighbourlink` schema and requires TLS certificate verification. `SUPABASE_CA_CERT` can point to a trusted CA bundle when required by the deployment environment. Existing SQLite records are not copied to PostgreSQL automatically.

## Migrations, settings, and data safety

Database changes run as ordered, transactional migrations recorded in `schema_migrations`. New marketplace values are seeded into `marketplace_settings`; current values are placeholders and must be validated with real users before commercial use. Booking status changes are recorded in append-only `booking_status_audit`; money events are recorded in append-only `money_ledger`. Gear checkout now uses the provider TEST adapter, while the legacy `demo_payments` table is retained only so existing installations can migrate without deleting historical records. It is no longer used by the application. Never treat test-mode checkout as a real payment.

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
- Owners approve requests; participants have a private conversation and can leave mutual ratings after Gear bookings complete.
- Account creation requires email verification and a complete profile with a validated phone number and profile photo.
- The Gear request dialog shows booked and owner-blocked dates in a month calendar. Selecting pickup and return days updates the rental and deposit quote before a request is sent.
- Gear browsing has quick filters for this weekend and gear under ₹500 per day, plus the existing nearest-first sort, area search, and distance display when location is shared.
- Phone numbers are verified using single-use, rate-limited SMS codes. Gear listings include item value; new renters are limited to lower-value items until they build rental history and ratings.
- Gear listings include a condition checklist and calculated refundable deposit. Both renter and owner submit private pickup and return photos; phone contact becomes visible only after payment. Paid bookings include a settings-governed cancellation window, claim window and late-fee assessment.
- During the claim window an owner can submit a claim with a supporting photo. The renter can reply once. Authorized admins compare the claim photo with handover/return evidence, conversation and status history before deciding the deposit outcome. Photos remain private to participants and admins.
- Optional government ID and selfie review uses encrypted image storage, restricted admin access, reviewer decision states, and an access audit. Reviewed documents are removed after the settings-driven retention period (currently a 90-day placeholder); pending reviews remain available until decided. NeighbourLink does not ask for Aadhaar numbers.
- Password recovery uses single-use, expiring email links.
- Admin reports and booking history are available to authorized accounts. The configured admin also has private member/KYC, listing, claim, and append-only ledger views with dispute, loss, repeat-renter, and commission indicators.
- Search filters cover category, price, dates, owner rating, and approximate distance; owners can manage availability blocks from their account. Seller earnings and release dates are estimated from the payment ledger and clearly labeled as estimates.
- Transactional email uses a retryable, deduplicated outbox. Public policy pages remain clearly marked as drafts pending legal review.
- Shop accounts support owner/manager/staff roles, consent-based email invitations, encrypted business-document review, drafts, duplicate-as-draft, multi-unit stock, active-listing/quantity entitlements, and basic inventory/booking reports. Business review, invitation, and staff-role changes have append-only audit trails; only admins can review or open business documents.
- Community and Neighbourhood Plus subscription plans are implemented behind the Razorpay TEST subscription adapter and signed webhooks. Price and limits are placeholders; configure the TEST plan ID before paid checkout.
- Example photos are illustrative only; member listings use the photo uploaded by the owner.

## Scope and release gates

The current release remains a marketplace pilot, not a production payment or escrow service. Gear now has condition checklists, trust-adjusted deposits, test-mode Razorpay Route settlement holds, two-sided timestamped evidence, owner claim photos, renter responses, audited admin deposit decisions, automatic no-claim deposit reversal/refund, late-fee assessment, and mutual reviews. Route approval, activated linked accounts, and end-to-end payment, webhook, reversal, refund and settlement verification are still required. Money must never be held by NeighbourLink. Payment, deposit, claim-window, and fee settings are placeholders until validated with real users and reviewed for applicable law. Admin loss/dispute/repeat rates are operational indicators and are not accounting statements.

The supplied Phase 5 checklist ended at “Subscription plans”; its remaining text was not available. The visible requirements have been implemented locally. Add any missing checklist items before treating the broader Phase 5 scope as final.
