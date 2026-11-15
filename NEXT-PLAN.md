# NeighbourLink next implementation plan — revised approval draft

Prepared after reviewing `AUDIT.md` on branch `fix/audit-high-demo-safety`.

## Earlier audit fixes and current safety-gate results

The audit recorded **no reproduced Critical issue**. Its two High findings were present and are addressed in commit `b37f0d3`:

1. **H1, unsafe demo reset:** reset now checks for real or derived records linked to demo users, listings, and bookings inside its database transaction. It refuses with a named table instead of deleting their dependencies. PostgreSQL reset also locks affected tables during the check and deletion. A regression test creates a real request for demo inventory, confirms reset refuses without deleting anything, removes that request, then confirms reset succeeds.
2. **H2, inconsistent advanced demo bookings:** seeded booking histories are labelled as **read-only samples** in both conversation views. The server rejects mutation and checkout/contact actions for sample bookings. A regression test confirms a sample remains readable while message posting, status changes, and checkout return 409. The README states that no real payment or handover occurred.

`npm test` passes **4/4** on SQLite in this turn when local loopback access is allowed. The first attempt failed because the environment denied the tests' connections to `127.0.0.1`; rerunning with local test-server access passed. Supabase/PostgreSQL execution and visual browser behavior still need direct verification; the audit's original results remain a historical snapshot. The safety gate is **open**, not completed.

## Verification of the independent review

I checked the schema, routes, client code, and tests rather than accepting the review at face value. `database.mjs` has migrations for email/reset tokens, KYC, booking audit, ledger, evidence, availability, shops, and demo markers. `server.mjs` has the corresponding API paths and a Razorpay adapter, but the provider's actual checkout and settlement have not been proven end to end. The Gear evidence route requires one photo upload from each side and then changes status; it does not record an explicit checklist confirmation or a handover code. Hire has a shorter status path and no before/after evidence flow. There are exactly four tests discovered by `node --test`, and they configure SQLite. The rate limits key directly on `req.socket.remoteAddress` in six places. I found no live/ready health endpoints, session listing/revocation, photo-use consent, saved searches, Wanted board, or Hindi string catalogue. These are code findings; the two-account visual check and disposable PostgreSQL run remain open.

## Safety gate — before Phase A

**Branch:** continue `fix/audit-high-demo-safety` for audit fixes; open a PR against `main` only after the gate evidence and tests are attached. The two High fixes already on this branch are not merged.

1. Provision an explicitly disposable PostgreSQL instance or Supabase test project, with a fresh database URL that cannot point to the live project. Never use the configured real Supabase project. The current tests force SQLite, so make the test harness run the same suite against PostgreSQL, then run it in both modes. Run seed/reset against the disposable target. Test migrations on an empty database, then on a copy populated with representative pre-migration data; compare row counts and key records before/after. Record commands, outcomes, and failures without printing credentials.
2. Walk the current Gear and Hire flows in a browser using two independent accounts. Test desktop and mobile widths, light and dark modes, account creation/sign-in, request/acceptance, messaging, available payment or completion steps, photos, and error/empty/loading states. Record each blocked or confusing step and do not imply an untested payment succeeded.
3. Add targeted regression tests for every safety or correctness gap found in that gate, including authorization, migration preservation, state transitions, seed safety, and visual-flow defects that can be asserted at the API or UI level. Catalogue missing product steps as explicit Phase P acceptance cases and implement their passing tests with Phase P. Keep `npm test` green on SQLite and the disposable PostgreSQL target.
4. Commit the audit fixes in small commits, update the evidence in `AUDIT.md` and run instructions in README, then open the audit-fix PR for owner review. Do not merge it. Phase A starts from the merged audit-fix branch.

**Dependencies:** a disposable PostgreSQL service and reliable browser automation must be available. No PostgreSQL or Docker command is installed in the current shell, and no disposable database URL has been identified. The previous audit could not run a browser walkthrough because the installed browser tool was unavailable. If either dependency remains unavailable, report that limitation and keep the gate open; do not substitute the live database or claim visual verification.

**Approval boundary:** this document update is planning only. No new tests, application changes, safety-gate run, or PR creation begins until the owner approves this revised plan.

## Existing foundations to reuse

The repository already has email codes, password reset links, cookie sessions, basic IP throttling, an email outbox, storage adapters, SQLite/PostgreSQL migrations, CI, backup script, policy drafts, phone OTP, KYC storage, trust calculations, Gear deposits, Razorpay TEST Route adapter, money ledger, booking audit, claims/admin screens, shops, staff roles, and subscription scaffolding. Each phase will verify the current behavior before expanding it. No framework change is planned.

## Phase A — Launch safety

**Branch:** `phase-a/launch-safety`, based on the merged audit-safety fix.

**Schema/migration:** extend `sessions` with device label, creation/last-seen/revocation data; add per-account abuse counters or security events with expiry; add explicit photo-use consent version/time and revocation record; add error-event metadata with retention limits. Keep existing auth records intact. Existing photos must not be newly shown through a consent-gated surface until valid consent is recorded; define a safe migration path for legacy uploads.

**Endpoints/services:** `GET /health/live`, `GET /health/ready` (no sensitive details); authenticated `GET /api/v1/sessions` and `DELETE /api/v1/sessions/:id`; consent read/update; account and IP limits on signup, login, email/phone OTP, reset, and uploads; a redacted error-monitoring adapter; scheduled backup plus a scripted restore verification. Preserve one-use email/reset tokens and server-side authorization. Derive client IP from forwarded headers only when `TRUST_PROXY` is enabled (default off) **and** the immediate proxy matches an explicit trusted-proxy allowlist; otherwise use the socket address. Never accept arbitrary client-supplied forwarding headers. Test both configurations and spoofed headers. Per-account keys must be independent of the IP keys, including for failed login and reset attempts where an account identifier is supplied.

**Screens:** account security/device list with revoke action; clear consent prompt before storing/displaying a profile or listing photo, labelled **for lawyer review**; accessible auth and profile errors; consistent focus, 14px minimum text, light/dark modes. Show policy drafts prominently as **for lawyer review**.

**Order:** inventory existing checks → migration → endpoints/adapters → account/consent UI → abuse tests, including a production-mode test proving mock OTP and mock email shortcuts are unreachable → two-account browser walkthrough → backup/restore drill → README and `.env.example` → independent audit and merge review.

**Risks/decisions:** forwarded IP must come only from a trusted proxy; device names are user-agent hints, not device identity. Monitoring must redact IDs, passwords, tokens, and image data. Backup storage/retention and legal consent language need owner choices. Existing policy text remains draft.

## Phase P — Complete Gear and Hire booking workflows

**Branch:** `phase-p/booking-workflows`, after Phase A is reviewed and merged. Keep Gear and Hire as distinct workflows. Do not describe either journey as complete until its own two-account browser test passes.

### Phase P schema and migrations

- Extend `requests` only with workflow version, agreed schedule, due time, and milestone references needed for read queries. Preserve its current status and legacy bookings. The migration must classify existing records as a legacy workflow instead of inventing confirmations or evidence.
- Add `booking_plans` (version, portal, pickup/service place and private address, start/end/slot, price, scope, proposer, expiry), `booking_plan_confirmations` (one row per party and plan version), and `booking_schedule_changes` (extension/reschedule proposal, response, conflict-check result, actor, timestamps). Do not put private address in public listing responses.
- Add `booking_codes` (booking, purpose: Gear handover/return or Hire start, salted hash, attempt count, lockout/expiry, used time) and `booking_arrivals` (actor, time, optional approved photo reference). Store no plaintext code after delivery.
- Extend or version `booking_evidence` for portal and stage: Gear handover/return and Hire before/after/rating. Store server timestamp, uploader, private object-storage key, content type, immutable submission time, and checklist snapshot. Add `booking_party_confirmations` so both Gear parties must affirm handover and return separately from uploading photos.
- Add `hire_quotes`, `hire_slots`, `hire_progress`, `hire_addons` (customer approval and amount), `hire_receipts`, `booking_no_shows`, and `booking_reports` with actor, decision, and audit references. Reuse the existing claim, rating, email outbox, status-audit, and money-ledger tables where their semantics fit. Put any new tunable window, fee, or cap in `marketplace_settings` as a placeholder, with no value change without explicit owner approval.
- Make active plan versions, code purposes, evidence submissions, quote decisions, and add-on approvals idempotent with uniqueness and state constraints on both SQLite and PostgreSQL. Keep audit and ledger append-only; every status and money transition is written transactionally with the source change.

### Phase P proposed endpoint groups

All paths below are under `/api/v1`; exact names can be refined in implementation without changing the permissions or outcomes. Every write validates input, role, booking ownership, current state, version, expiry, and idempotency on the server.

- **Plans and schedule:** `GET/POST /requests/:id/plan`, `POST /requests/:id/plan/confirm`, `POST /requests/:id/schedule-changes`, `POST /requests/:id/schedule-changes/:changeId/respond`, `GET /requests/:id/address`. Both parties see the current proposal; exact address is returned only to authorized parties after both confirm. Existing contact-detail payment rules remain separate. Extension/reschedule acceptance reruns availability and double-booking checks atomically.
- **Gear handover/return:** `POST /requests/:id/arrival`, `POST /requests/:id/codes/handover`, `POST /requests/:id/codes/handover/verify`, `POST /requests/:id/codes/return`, `POST /requests/:id/codes/return/verify`, `POST /requests/:id/evidence`, `POST /requests/:id/confirmations/handover`, `POST /requests/:id/confirmations/return`, and `GET /requests/:id/evidence`. Reuse the existing private upload route; progress only after both sides' photos, checklist, code, and explicit confirmations. Return feeds the existing claim window and admin issue path. Add an authorized, scheduled overdue marker and reminder.
- **Hire quote and appointment:** `GET/POST /requests/:id/quotes`, `POST /requests/:id/quotes/:quoteId/respond`, `GET/POST /listings/:id/slots`, `POST /requests/:id/on-the-way`, `POST /requests/:id/arrival`, `POST /requests/:id/codes/start`, `POST /requests/:id/codes/start/verify`, `POST /requests/:id/evidence` for before/after photos, `POST /requests/:id/addons`, `POST /requests/:id/addons/:addonId/respond`, `POST /requests/:id/completion/approve`, and `GET /requests/:id/receipt`. Provider and customer must confirm price, slot, scope, and address; the customer approves every paid add-on. Automatic completion runs only after a settings-driven review window and recorded notice.
- **Shared:** `POST /requests/:id/no-show`, `POST /requests/:id/cancel`, `POST /requests/:id/report`, `GET /requests/:id/timeline`, and booking notification events through the existing outbox. Reuse the existing claim and rating paths, extending ratings for private photo evidence where needed. Cancellation/no-show outcomes are policy-driven and audited.
- **Photo and code controls:** uploads pass through server-side type/size checks and the private storage adapter. Submission timestamps come only from the server; submitted evidence cannot be replaced or deleted. Read access is limited to the two booking parties and an authorized admin, with access audit where sensitive. Code verification has per-account and per-IP limits, attempt lockout, one use, expiry, constant-time comparison, and no code in logs or API reads.

**Gear endpoints/services:** agree on pickup place, time, days, and final price with both parties; unlock the private address only after both confirm and require payment before contact sharing where policy requires it. Record arrival; generate and rate-limit a four-digit handover code; require separate photos, checklist submissions, and confirmation from both parties before `active`. Support extension request/acceptance with date conflict checks, overdue state/notification, rescheduling and no-show. At return require both parties' photos/checklists and a return code; show paired evidence; retain the claim window, automatic completion, issue flow, and mutual ratings. Every change is server-authorized, audited, and tested for retries and races.

**Hire endpoints/services:** quote and confirm price, appointment slot, and scope; let the provider mark on-the-way and arrival with a provider photo and start code. Require before photos, explicit approval for paid add-ons, after photos, customer approval or documented automatic completion window, receipt, and photo-supported ratings. Include reschedule, cancellation, no-show, notification, report, and timeline actions. Use an adapter for any future paid Hire flow; no new money movement bypasses the append-only ledger.

### Phase P screens

- **Gear renter and owner:** plan proposal and two-party confirmation; gated pickup address; arrival and code entry; separate photo/checklist/confirm panels; extension request and approval; overdue notice; return code/photos/checklists; paired handover-versus-return photo comparison; claim/review window and mutual ratings.
- **Hire customer and provider:** quote comparison and price/scope confirmation; provider availability slots; address confirmation; on-the-way and arrival indicator with provider photo/start code; before/after photo panels; add-on approval; customer completion approval and countdown; receipt and photo-supported ratings.
- **Shared:** a chronological booking timeline with actor, milestone, and scheduled next step; cancel, reschedule, no-show, report, and notification entry points on every booking. Keep Gear and Hire navigation separate. Every view needs permission-aware actions, loading/empty/error states, mobile and desktop layouts, light/dark modes, focus states, 14px minimum text, and one primary action per area in the existing neo-brutalist style.

### Phase P verification

Focused tests cover every new endpoint group, wrong-party and unrelated-user access to bookings and private photos, forged timestamps and upload types/sizes, immutable submitted evidence, skipped/repeated/reversed states, two simultaneous date bookings, extension/reschedule races, code brute force and lockout, plan-gated address exposure, notification/idempotency behavior, and complete Gear and Hire happy paths. Run the same tests on SQLite and disposable PostgreSQL, then perform the two-account browser walkthrough in both themes and viewport sizes.

**Order:** map existing state paths and permission matrix → migration/backfill → Gear plan and codes → Gear evidence/extension/return → Hire quote and slot → Hire progress/evidence/add-ons/receipt → shared reschedule/no-show/report/timeline → API, concurrency, and two-account browser tests → README and `.env.example` → phase PR. Do not claim completion while any required step is mock-only or untested.

**Risks/decisions:** code delivery must not become a bypassable security control; lockout and expiry are mandatory. Four-digit codes have low entropy, so use narrow attempt limits and server-side comparison. Exact cancellation, no-show, extension-fee, add-on, and auto-complete rules need documented product/policy choices before enabling financial effects. Avoid exposing exact home addresses outside confirmed bookings.

## Phase B — Payments and deposits

**Branch:** `phase-b/provider-payments` after Phase P passes its gate.

**Schema/migration:** extend provider order/transfer records for idempotent hold, capture, refund, reversal, reconciliation, invoice/receipt references, and payout state. Use the existing append-only `money_ledger`; no direct writes that bypass it. Keep all percentages, multipliers, caps, commission, claim window, and late fees in `marketplace_settings` with a documented change audit. Migrate old records without inventing settlement events.

**Endpoints/services:** Razorpay **TEST** adapter with mock in tests; signed webhooks; provider-side hold/release/capture only where the provider actually supports it; booking quote; refund/cancellation; receipt download; admin ledger and reconciliation. Verify the provider's real pre-authorization and settlement capabilities before designing the Phase B flow. Every status and money event gets an idempotent, transactional audit entry.

**Screens:** renter checkout summary, owner payment status, cancellation/refund outcome, downloadable receipt, and admin ledger/reconciliation view with loading/empty/error states.

**Order:** verify current Route API assumptions and provider approval → design settlement state diagram → migration/adapter → webhook and race tests → UI → two-account TEST checkout and refund walkthrough → docs.

**Risks/decisions:** NeighbourLink must never receive or hold customer money. A provider's actual pre-authorization/escrow capability and marketplace settlement terms must be verified before implementing the flow. Financial numbers remain placeholders in `marketplace_settings`; none change without the owner's explicit approval. Real-user testing and lawyer/CA review remain necessary. Live keys are outside this phase.

## Phase C — Identity and trust

**Branch:** `phase-c/identity-trust`.

**Schema/migration:** extend existing KYC/status and trust records only where missing: consent version, provider reference, expiry/review timestamp, account state audit, and trust calculation version. Avoid storing government ID numbers in the core database.

**Endpoints/services:** testable SMS and KYC adapters; OTP attempt limits; suspension and reinstatement actions; recomputed score from completed rentals and ratings; value limits for new users and settings-driven deposit reductions for high trust. Design encrypted ID/selfie handling for authorized reviewers but do not enable real ID collection. No deposit-number change without explicit owner approval.

**Screens:** verification status, retry/alternative ID path, trust explanation, admin review with access audit and retention notice.

**Order:** data minimization review → migration → adapters/authorization → state and scoring tests → UI and two-account walkthrough → docs.

**Risks/decisions:** legal basis, alternative ID options, document retention, processor contract, and manual-review staffing need owner approval before real KYC collection. Existing local mock OTP and mock email shortcuts must remain impossible in production, with Phase A regression tests.

## Phase D — Admin and disputes

**Branch:** `phase-d/admin-disputes`.

**Schema/migration:** extend existing claim/audit tables for evidence pairing, decision reason, appeal/reopen record if approved, reconciliation reference, and measured response-time snapshots. Keep booking audit and ledger append-only.

**Endpoints/services:** scoped admin user/KYC/listing/claim/payment views; full/partial/no deduction with immutable decision history; provider settlement reconciliation; defined metrics for loss, disputes, repeat use, revenue per booking, and response time. Every decision requires an actor and reason.

**Screens:** side-by-side handover/return evidence, chat and timeline, decision form, payment/payout queue, and metric definitions alongside charts.

**Order:** permission matrix → migration → decision and provider failure tests → admin UI → browser walkthrough with admin plus two users → docs.

**Risks/decisions:** the present claim UI is not a legal adjudication system. Define appeals, evidence retention, access roles, and financial metric definitions before launch.

## Phase E — Growth

**Branch:** `phase-e/community-growth`.

**Schema/migration:** invite/referral attribution, credit event ledger, share token metadata, verified-community membership, privacy-limited product events with retention/consent, saved searches, Wanted posts/responses, and language preference. Referral credits with monetary value must appear in the append-only money ledger.

**Endpoints/services:** invite acceptance and abuse limits; shareable listing metadata; consent-based distance/map queries; community verification and access controls; saved-search alerts, Wanted board moderation, and English/Hindi string catalogue; aggregate analytics export without sensitive location trails.

**Screens:** society invite join page, WhatsApp share action, map/list toggle, community badge/filter, saved-search and Wanted views, English/Hindi language control, and analytics consent controls.

**Order:** privacy and fraud model → migration → routes → screens → tests → two-user browser review → docs.

**Risks/decisions:** society verification authority, referral value, fraud limits, mapping provider/cost, and location precision need decisions. Do not expose exact home coordinates.

## Phase F — Business accounts and installable app

**Branch:** `phase-f/business-pwa`, optional and last.

**Schema/migration:** extend current business accounts/inventory/plans for commission overrides, featured listing dates/audit, and push subscriptions. Existing shop subscription states need idempotent reconciliation before enabling paid tiers.

**Endpoints/services:** role-checked inventory and staff changes; plan-based listing/quantity/commission limits from the central settings/plan tables; featured placement audit; push subscription lifecycle and notification preferences.

**Screens:** staff inventory/report dashboard, plan comparison, featured placement disclosure, PWA install prompt/offline state, push preferences. Evaluate a desktop admin wrapper only after the web admin panel and PWA are stable.

**Order:** verify current shops → migration → policy/permission tests → UI → install/offline/push browser tests → optional desktop feasibility decision → docs.

**Risks/decisions:** paid subscription and featured placement need clear disclosure, provider approval, and pricing review. Push requires browser/platform support and an opt-in. Desktop packaging adds update and code-signing work.

## Code health within the phases

Expand the four current broad tests into focused endpoint-group suites during the safety gate and each phase. Use the same behavior tests against SQLite and a disposable PostgreSQL database, with isolated data per run. Include migration upgrade tests and explicit server permission/state/race cases. A provider test mode or mock is never evidence that live payments work.

After Phase P is merged, split `server.mjs` by stable responsibility into an HTTP entry point, authenticated route groups (auth, listings, Gear bookings, Hire jobs, admin, payments), shared validation/authorization helpers, and services (notifications, storage, scheduling, settlement). Split `app.js` into UI sections for auth/profile, Gear, Hire, seller, and admin with shared API/state/render helpers. Move one bounded section at a time with no behavior change; run SQLite and PostgreSQL tests before and after each move, plus a two-account browser check. Avoid a framework migration or a simultaneous rewrite.

## Phase sequence and gate after each phase

The order is **safety gate → A → P → B → C → D → E → F**. One phase per branch and review; start each branch from the prior merged phase. All new endpoints get authorization, validation, failure-path and race tests; every booking status change and money event receives an append-only record. `npm test` stays green on SQLite and disposable PostgreSQL. Verify two real test accounts in desktop/mobile browser at light/dark settings, keyboard focus, text at least 14px, empty/loading/error states, and one primary action per area. After each phase update README and `.env.example`, document the run/restore steps, and write a short summary of what changed, what is manual, and what needs an owner decision. The owner will arrange a separate independent audit before each phase is merged. Do not merge or deploy based on tests alone.

**Approval gate:** no implementation or safety-gate execution starts until this revised plan is reviewed and approved. Gear and Hire must not be described as complete before Phase P passes its gate.
