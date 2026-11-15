# NeighbourLink next implementation plan

Prepared after reviewing `AUDIT.md` on branch `fix/audit-high-demo-safety`.

## Safety gate completed before this plan

The audit recorded **no reproduced Critical issue**. Its two High findings were present and are addressed in commit `b37f0d3`:

1. **H1, unsafe demo reset:** reset now checks for real or derived records linked to demo users, listings, and bookings inside its database transaction. It refuses with a named table instead of deleting their dependencies. PostgreSQL reset also locks affected tables during the check and deletion. A regression test creates a real request for demo inventory, confirms reset refuses without deleting anything, removes that request, then confirms reset succeeds.
2. **H2, inconsistent advanced demo bookings:** seeded booking histories are labelled as **read-only samples** in both conversation views. The server rejects mutation and checkout/contact actions for sample bookings. A regression test confirms a sample remains readable while message posting, status changes, and checkout return 409. The README states that no real payment or handover occurred.

`npm test` passes **4/4**. This verifies SQLite and the sampled HTTP paths. Supabase/PostgreSQL execution and visual browser behavior still need direct verification; the audit's original results remain a historical snapshot.

## Existing foundations to reuse

The repository already has email codes, password reset links, cookie sessions, basic IP throttling, an email outbox, storage adapters, SQLite/PostgreSQL migrations, CI, backup script, policy drafts, phone OTP, KYC storage, trust calculations, Gear deposits, Razorpay TEST Route adapter, money ledger, booking audit, claims/admin screens, shops, staff roles, and subscription scaffolding. Each phase will verify the current behavior before expanding it. No framework change is planned.

## Phase A — Launch safety

**Branch:** `phase-a/launch-safety`, based on the merged audit-safety fix.

**Schema/migration:** extend `sessions` with device label, creation/last-seen/revocation data; add per-account abuse counters or security events with expiry; add explicit photo-use consent version/time and revocation record; add error-event metadata with retention limits. Keep existing auth records intact.

**Endpoints/services:** `GET /health/live`, `GET /health/ready` (no sensitive details); authenticated `GET /api/v1/sessions` and `DELETE /api/v1/sessions/:id`; consent read/update; account and IP limits on signup, login, email/phone OTP, reset, and uploads; a redacted error-monitoring adapter; scheduled backup plus a scripted restore verification. Preserve one-use email/reset tokens and server-side authorization.

**Screens:** account security/device list with revoke action; clear consent prompt before storing/displaying a profile or listing photo; accessible auth and profile errors; consistent focus, 14px minimum text, light/dark modes. Show policy drafts prominently as **for lawyer review**.

**Order:** inventory existing checks → migration → endpoints/adapters → account/consent UI → abuse tests and two-account browser walkthrough → backup/restore drill → README and `.env.example` → merge review.

**Risks/decisions:** forwarded IP must come only from a trusted proxy; device names are user-agent hints, not device identity. Monitoring must redact IDs, passwords, tokens, and image data. Backup storage/retention and legal consent language need owner choices. Existing policy text remains draft.

## Phase B — Payments and deposits

**Branch:** `phase-b/provider-payments` after Phase A passes its gate.

**Schema/migration:** extend provider order/transfer records for idempotent hold, capture, refund, reversal, reconciliation, invoice/receipt references, and payout state. Use the existing append-only `money_ledger`; no direct writes that bypass it. Keep all percentages, multipliers, caps, commission, claim window, and late fees in `marketplace_settings` with a documented change audit. Migrate old records without inventing settlement events.

**Endpoints/services:** small Razorpay or Cashfree **TEST** adapter with mock in tests; signed webhooks; provider-side hold/release/capture only; booking quote; refund/cancellation; receipt download; admin ledger and reconciliation. Every status and money event gets an idempotent, transactional audit entry.

**Screens:** renter checkout summary, owner payment status, cancellation/refund outcome, downloadable receipt, and admin ledger/reconciliation view with loading/empty/error states.

**Order:** verify current Route API assumptions and provider approval → design settlement state diagram → migration/adapter → webhook and race tests → UI → two-account TEST checkout and refund walkthrough → docs.

**Risks/decisions:** NeighbourLink must never receive or hold customer money. A provider's actual pre-authorization/escrow capability and marketplace settlement terms must be verified before implementing the flow. Financial numbers remain placeholders until real-user testing and lawyer/CA review. Live keys are outside this phase.

## Phase C — Identity and trust

**Branch:** `phase-c/identity-trust`.

**Schema/migration:** extend existing KYC/status and trust records only where missing: consent version, provider reference, expiry/review timestamp, account state audit, and trust calculation version. Avoid storing government ID numbers in the core database.

**Endpoints/services:** testable SMS and KYC adapters; OTP attempt limits; encrypted ID/selfie access for authorized reviewers only; suspension and reinstatement actions; recomputed score from completed rentals and ratings; value limits for new users and settings-driven deposit reductions for high trust.

**Screens:** verification status, retry/alternative ID path, trust explanation, admin review with access audit and retention notice.

**Order:** data minimization review → migration → adapters/authorization → state and scoring tests → UI and two-account walkthrough → docs.

**Risks/decisions:** legal basis, alternative ID options, document retention, processor contract, and manual-review staffing need owner approval before real KYC collection. Existing local mock OTP must remain impossible in production.

## Phase D — Admin and disputes

**Branch:** `phase-d/admin-disputes`.

**Schema/migration:** extend existing claim/audit tables for evidence pairing, decision reason, appeal/reopen record if approved, reconciliation reference, and measured response-time snapshots. Keep booking audit and ledger append-only.

**Endpoints/services:** scoped admin user/KYC/listing/claim/payment views; full/partial/no deduction with immutable decision history; provider settlement reconciliation; defined metrics for loss, disputes, repeat use, revenue per booking, and response time. Every decision requires an actor and reason.

**Screens:** side-by-side handover/return evidence, chat and timeline, decision form, payment/payout queue, and metric definitions alongside charts.

**Order:** permission matrix → migration → decision and provider failure tests → admin UI → browser walkthrough with admin plus two users → docs.

**Risks/decisions:** the present claim UI is not a legal adjudication system. Define appeals, evidence retention, access roles, and financial metric definitions before launch.

## Phase E — Growth

**Branch:** `phase-e/community-growth`.

**Schema/migration:** invite/referral attribution, credit event ledger, share token metadata, verified-community membership, and privacy-limited product events with retention/consent. Referral credits with monetary value must appear in the append-only money ledger.

**Endpoints/services:** invite acceptance and abuse limits; shareable listing metadata; consent-based distance/map queries; community verification and access controls; aggregate analytics export without sensitive location trails.

**Screens:** society invite join page, WhatsApp share action, map/list toggle, community badge/filter, and analytics consent controls.

**Order:** privacy and fraud model → migration → routes → screens → tests → two-user browser review → docs.

**Risks/decisions:** society verification authority, referral value, fraud limits, mapping provider/cost, and location precision need decisions. Do not expose exact home coordinates.

## Phase F — Business accounts and installable app

**Branch:** `phase-f/business-pwa`.

**Schema/migration:** extend current business accounts/inventory/plans for commission overrides, featured listing dates/audit, and push subscriptions. Existing shop subscription states need idempotent reconciliation before enabling paid tiers.

**Endpoints/services:** role-checked inventory and staff changes; plan-based listing/quantity/commission limits from the central settings/plan tables; featured placement audit; push subscription lifecycle and notification preferences.

**Screens:** staff inventory/report dashboard, plan comparison, featured placement disclosure, PWA install prompt/offline state, push preferences. Evaluate a desktop admin wrapper only after the web admin panel and PWA are stable.

**Order:** verify current shops → migration → policy/permission tests → UI → install/offline/push browser tests → desktop feasibility decision → docs.

**Risks/decisions:** paid subscription and featured placement need clear disclosure, provider approval, and pricing review. Push requires browser/platform support and an opt-in. Desktop packaging adds update and code-signing work.

## Gate after each phase

One phase per branch and review. All new endpoints get authorization, validation, failure-path and race tests; every booking status change and money event receives an append-only record. `npm test` stays green. Use a disposable SQLite database and, where configured, Supabase PostgreSQL migration tests. Verify two real test accounts in desktop/mobile browser at light/dark settings, keyboard focus, text at least 14px, empty/loading/error states, and one primary action per area. Update README, `.env.example`, restore instructions, and a short phase summary. Do not merge or deploy based on tests alone.

## Scope gap to decide before launch

`AUDIT.md` also found missing Gear handover codes/checklists/extensions and Hire arrival/progress/photos/quotes. Those are not explicitly included in Phases A–F above. The current site must not be described as completing those journeys. A separate product-flow phase should be approved or the launch scope narrowed before a public launch.

**Approval gate:** no Phase A implementation starts until this plan is reviewed and approved.
