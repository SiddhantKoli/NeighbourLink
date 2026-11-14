# NeighbourLink implementation plan

## Delivery status

- **Phase 0 — Foundation: implemented locally.** Versioned migrations, account email verification/recovery, private object storage adapters and legacy-image migration utility, append-only audit/ledger protections, CI, and SQLite backup/restore instructions are in place. SQLite is covered by tests; a live Supabase migration has not yet been verified.
- **Phase 1 — Identity and trust: implemented locally.** SMS OTP delivery has a Twilio adapter and test mock; phone verification is required to finish signup. Manual KYC review stores app-encrypted ID/selfie images, exposes them only to the configured admin, and audits access and decisions. Trust scores use completed rentals and ratings received as an owner; new renters are capped by a settings-driven gear item-value tier. External KYC providers and mutual renter reviews remain future work.
- **Phase 2 — Protected rental flow: implemented locally.** Gear listings now require a condition checklist. Deposit quotes apply settings-backed item-value, category, renter-trust and duration multipliers, clamp to configured bounds, and constrain owner overrides. The booking flow uses requested/accepted/paid/active/claim_window/completed plus cancelled/disputed states, two-sided private evidence, verified test-mode Razorpay order checkout/webhooks, append-only money events, post-payment contacts, mutual reviews, a free-cancel cutoff, automatic late-fee payout from the deposit, and no-claim deposit release/refund. Automated tests cover the SQLite path. Razorpay TEST credentials, Route product approval, activated seller linked accounts and provider dashboard/webhook verification remain external setup gates; no real-money or live-key path is enabled.
- Phases 3–5 remain in the ordered plan below. Phase 3 is next.
- The supplied Phase 5 text is incomplete; it ends at “Subscription plans.”

## Starting architecture (before implementation)

- **Runtime:** Node.js 24, one `server.mjs` HTTP server, plain HTML/CSS/JavaScript, and a versioned JSON API at `/api/v1`. The browser portal and a future desktop client can share the same server API.
- **Data:** `database.mjs` selects SQLite by default or PostgreSQL when `DATABASE_URL` is configured. The PostgreSQL path creates a private `neighbourlink` schema. Tables are created and altered during startup; there is no ordered, repeatable migration runner yet.
- **Accounts:** email/password accounts use Node `scrypt`; sessions use random tokens stored as digests and HttpOnly cookies. A required profile setup collects name, phone number, and profile photo. There is no email delivery, email ownership confirmation, password reset, or phone OTP.
- **Marketplace:** gear and local-help listings, saved items, listing reports, request conversations/messages, a single customer rating, and an admin report queue. The server validates request data and checks participant/owner permissions on the implemented routes.
- **Bookings and payments:** booking states currently cover `pending`, `accepted`, `active`, `returned`, `completed`, and supporting `declined`, `cancelled`, and `completion_proposed` states. PostgreSQL and application checks prevent overlapping gear bookings. Checkout is a simulated `demo_payments` record; it does not collect money.
- **Files:** listing photos and profile photos are base64 strings in SQL. Listing photos are served by numeric ID. There is no object-storage adapter, booking evidence upload, or private file authorization model.
- **UI:** the existing portal pages are plain HTML/CSS/JS with the neo-brutalist visual language, mint/amber palette, Space Grotesk, and a central parent-page API bridge. New UI must preserve this system and keep readable text at 14px or above.
- **Checks and operations:** `marketplace.test.mjs` runs one broad integration flow against an isolated in-memory SQLite database. `npm test` is the test command. There is no CI workflow, migration-specific coverage, or documented tested backup/restore procedure.

## Gaps against the requested product goals (updated after Phase 0)

### Phase 0 — Foundation

1. Email verification and recovery are implemented with expiring, one-use tokens and a Resend adapter. Production delivery still needs a verified sender and credentials.
2. New photos use private local or S3-compatible object storage with validation. Existing base64 photos need the documented preview/apply migration to move them.
3. Ordered database migrations, append-only booking audit and money ledger tables, and centralized placeholder settings are implemented.
4. CI runs the test suite; SQLite backup is scriptable and documented. Supabase backup/restore remains a managed operational procedure and has not been exercised against the live project.

### Phase 1 — Identity and trust

1. Twilio OTP, rate-limited challenge records, and required phone verification are implemented; production SMS credentials and sender configuration still need to be supplied.
2. Manual-review ID/selfie KYC is implemented with AES-GCM encryption, restricted admin access, explicit status, append-only access/decision audit, and settings-driven document retention. No automated third-party identity provider is configured.
3. Explainable trust score and new-renter item-value limits are implemented with placeholder settings. Mutual ratings are still needed to rate renters directly.

### Phase 2 — Protected rental flow

Implemented locally as described above. Phase 3 still needs renter claim responses, protected admin decisions that split/reverse/refund held funds, photo comparison, and operational/payment reconciliation. Razorpay Route must approve NeighbourLink's model before any pilot that processes provider payments.

### Phase 3 — Disputes and administration

1. Reports only moderate listings; there is no rental dispute workflow, evidence comparison, response window, or resolution record.
2. Admin tools do not cover users, KYC review, ledger, or operational/business metrics.

### Phase 4 — Marketplace usability

1. Owners cannot block calendar dates; search has no complete category/distance/price/date/rating filter and sort set.
2. Seller view is limited to listings and requests; it has no earnings or payout summary.
3. There is no notification adapter, transactional email, or terms/privacy/cancellation/banned-items pages.

### Phase 5 — Business accounts and revenue

1. There are no shop accounts, business verification, staff roles, multi-quantity inventory, duplicate listing, drafts, or shop reports.
2. The supplied brief ends at “Subscription plans”; the remaining Phase 5 requirements were not included. The visible Phase 5 requirements will be planned now, and the missing remainder should be appended when available.

## Implementation order

Work in phase-sized, reviewable commits. After each phase: run `npm test`, resolve regressions, update README run/environment instructions, and summarize the completed phase before beginning the next.

### 0. Foundation

1. Establish baseline test and database behavior; preserve SQLite and Supabase PostgreSQL compatibility. SQLite migrations are exercised by tests; run PostgreSQL migrations against the configured Supabase project before calling that path verified.
2. Add versioned migrations and migrate existing SQLite/PostgreSQL installations without losing data. Add tables and indexes for verification/reset tokens, settings, booking status audit events, and append-only money ledger events. Remove `demo_payments` only when the new adapter/ledger path is safely migrated.
3. Add a small email adapter (mock for tests, configurable provider for real delivery), expiring single-use email verification and password-reset tokens, and server-authorized endpoints. Never email or log passwords/tokens.
4. Add an S3-compatible object-storage interface with a local/mock test implementation, server-side type/size checks, private keys for profile and listing photos, and authorized reads. Migrate existing base64 photos before removing the old columns or compatibility reads.
5. Add CI for supported Node 24 test runs; document and exercise SQLite and Supabase backup/restore, environment variables, migrations, and storage configuration.

### 1. Identity and trust

1. Add an SMS interface with a mock adapter; implement expiring, rate-limited phone OTP challenge/verification and tests.
2. Define a provider-neutral KYC adapter and explicit `unverified` / `verified` / `suspended` state. Store only provider references and minimum decision metadata in the app; place ID/selfie documents in encrypted, private storage with least-privilege reviewer access, retention rules, and access audit events.
3. Calculate an explainable trust score from completed rentals and mutual ratings; enforce conservative, settings-driven item-value tiers for new renters.

### 2. Protected rental flow

1. Extend listings with item value, condition checklist, and bounded owner deposit override. Put all financial/risk settings in the settings table.
2. Define and test the booking state machine and permissions before wiring money movement. Record each status change with actor, time, and old/new state.
3. Implement a Razorpay or Cashfree TEST-mode adapter (selected through configuration), with signed/idempotent webhook handling. Charge/authorize renter amounts only through the provider; ledger every hold, capture, release, payout, refund, commission, and adjustment. Never maintain a platform-held customer balance.
4. Add private, timestamped, booking-bound handover and return evidence uploads from both parties; release owner contact only after the required payment state.
5. Add claim-window and late-fee jobs, cancellations/refunds, mutual ratings, and reconciliation. Ensure every automated and manual money action creates a ledger event.

### 3. Disputes and admin

1. Add claim creation, evidence, renter response, deposit freeze via provider-supported operations, and a fully audited resolution workflow.
2. Add a protected admin queue comparing handover/return evidence with chat and booking history.
3. Add admin views for users/KYC, listings, ledger, loss/dispute/repeat rates, and revenue, with authorization tests and safe handling of sensitive data.

### 4. Marketplace usability

1. Add owner availability blocks and date-aware search, then category, approximate distance, price, and owner-rating filters/sorts with privacy-preserving location behavior.
2. Add a seller dashboard based on ledger/provider data for earnings and next payout, plus listings and bookings.
3. Add provider-neutral transactional notifications (email first; push/SMS/WhatsApp adapters later) and draft terms, privacy, cancellation/refund, and banned-items pages marked for lawyer review.

### 5. Business accounts and revenue

1. Add shop accounts, business verification, staff roles/permissions, multi-quantity inventory, duplicate listing, drafts, and basic reports.
2. Add subscription-plan entitlements and billing through the configured payment provider, with ledger entries, webhook idempotency, cancellation, and tests.
3. Incorporate the rest of Phase 5 when the missing brief text is supplied.

## Constraints and release gates

- Keep Node 24 and plain HTML/CSS/JS; do not add a frontend framework.
- Do not hold customer funds. A provider's supported marketplace/connected-account settlement model must be confirmed before claiming escrow-like protection; never describe a payment authorization as escrow.
- New amounts, percentages, time windows, and score thresholds are placeholders in centralized settings until pilot data justifies them.
- Validate inputs, authorize every endpoint, and test every new route and state transition. Keep `npm test` green.
- Preserve the existing UI style, minimum 14px text, and one primary action per area.
- Avoid destructive schema or file migration steps until copy/rollback and restore coverage exists.
