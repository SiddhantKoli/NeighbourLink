# Independent QA and security audit — 2026-11-15

## Scope and score

**Audited branch:** `main` at `de013f5941f195d13c69aa0d1972328a7b0d9908` (`origin/main` matched). `git log --stat -20` returned the available 18 commits. No application code was changed for this audit.

**Readiness score: 31/100.** The seed is useful for a local catalogue demo and sampled API authorization held up. The requested Gear and Hire journeys are largely absent, seeded advanced bookings do not have the records those journeys require, and browser QA could not be completed. This is a coverage judgment, not a measured security grade.

**Setup:** `npm ci` passed (40 packages, 0 reported vulnerabilities); `npm test` passed 4/4. `npm start` launched an isolated in-memory server on port 60397. `npm run seed` on the existing local demo database said `Demo dataset already exists; no rows added.` A separate disposable database was seeded and reset by `demo-seed.test.mjs`. Explicit `NODE_ENV=production DEMO_SEED=1 npm run seed` failed with `Error: Demo seeding requires DEMO_SEED=1 and a non-production NODE_ENV.`

**Tool limits and failures:** `npm ci --offline` failed with `ENOTCACHED` for `https://registry.npmjs.org/xtend/-/xtend-4.0.2.tgz`; regular `npm ci` succeeded. The installed `agent-browser` command was unavailable. Automatic approval review rejected `npx --yes agent-browser skills get core` because it would download and execute an unpinned external package. Chrome and Edge headless screenshot attempts produced no screenshot file and no actionable error. Two-user interactive browser walks, mobile layout, dark mode appearance, keyboard focus, and control duplication are therefore **not verified visually**. Static CSS inspection found text under 14px.

## Requirement checklist

`PASS` means tested or directly demonstrated. `PARTIAL` means some implemented behavior exists but the named requirement is incomplete. `MISSING` means no implementation was found in the reviewed code; browser behavior is not inferred from a README.

### A. Demo data

| Requirement | Result | Evidence and verification |
| --- | --- | --- |
| Seed and reset commands | PASS | `package.json:10-11`, `scripts/demo-seed.mjs:28-38`; ran seed; `demo-seed.test.mjs:9-35` runs seed, rerun, reset. |
| `is_demo` marking | PARTIAL | Migration `database.mjs:410-421` adds markers to seven data tables and demo photos. Local SQL counted all seeded rows marked. Runtime sessions created for demo users are unmarked, though reset removes them by user ID (`scripts/demo-seed.mjs:31`). No marker covers later normal interactions with demo content. |
| Production refusal | PASS | Guard at `scripts/demo-seed.mjs:5`; explicit production command failed with the exact error above. |
| Repeatable, deterministic, no duplicates | PARTIAL | Fixed pseudorandom seed and early exit in `scripts/demo-seed.mjs:10,38`; rerun did not duplicate. Dates and timestamps use current time (`:39`), so full output is not deterministic across days. |
| 40 users, 60 Gear, 40 Hire, about 80 bookings across statuses | PASS | Local read-only SQL: 40 demo users, 60 gear, 40 help, 80 requests; counts: pending 13, accepted 11, active 12, returned 10, completed 12, declined 11, cancelled 11. Generator: `scripts/demo-seed.mjs:40-64`. |
| Named accounts and sample states | PARTIAL | Four names at `scripts/demo-seed.mjs:41`; local SQL confirmed renter has active/completed/pending, owner and provider have pending owner work. Admin has accepted/cancelled as renter and no owner job; the promised sample state set is not present for every named account. |
| No hotlinked or real-person photos | PASS | `scripts/demo-seed.mjs:17-18,45,53-56` generates labelled SVGs in object storage. HTTP check returned 200 `image/svg+xml` for primary and extra art. |
| Clean reset preserves non-demo data | **PARTIAL** | Existing test preserves a non-demo user and standalone listing (`demo-seed.test.mjs:25-32`). A new disposable probe inserted a real booking for a demo listing, ran reset, and got `orphanRequests: 1` with reset status 0. See High bug H1. |

### B. Gear workflow

| Requirement | Result | Evidence and verification |
| --- | --- | --- |
| Plan place, time, days, price; both confirm | PARTIAL | Booking asks dates/details and shows quote (`app.js:163-224`); owner accepts (`server.mjs:1268-1318`). No structured pickup place/time or explicit two-party plan confirmation. Source review and API transition probe. |
| Address only after both confirm | MISSING | Only neighbourhood `area` is public (`server.mjs:58`); contact name/phone unlock after payment, not after plan confirmation (`server.mjs:1180-1186`). No address field found. |
| Arrival and four-digit handover code | MISSING | `server.mjs:1103-1136` advances by photos; no arrival-code table or endpoint. Source search. |
| Both-side handover photos and checklist | PARTIAL | Two distinct uploaders are required for photos (`server.mjs:1103-1130`); listing has a condition checklist (`database.mjs:186`), but no submitted checklist from either side. Existing tests and source review. |
| Active only when both confirm | PARTIAL | Two distinct handover photo uploads transition paid to active (`server.mjs:1117-1125`); no separate confirmation action. Existing tests. |
| Extension request | MISSING | No extension route or date-change workflow around `server.mjs:1268-1318`. Source search. |
| Overdue marking | PARTIAL | Late fee assessed on return (`server.mjs:1130-1145`); no separate overdue booking state or alert. Source review. |
| Return photos, checklist, code | PARTIAL | Both-side return photos exist (`server.mjs:1103-1133`); return checklist and code are absent. Existing tests/source review. |
| Side-by-side photo view | PARTIAL | Evidence is rendered as a sequence of images (`app.js:976-985`, admin `:792-797`); no explicit paired handover/return comparison. Static review only. |
| Review window and automatic completion | PASS | Claim window is scheduled and processed (`server.mjs:252-293,1352-1354`); existing test uses a test-only expiry route (`marketplace.test.mjs`). Production scheduler behavior was not time-waited. |
| Issue flow and admin comparison | PARTIAL | Owner photo-backed claim and renter response exist (`server.mjs:1149-1177`); admin evidence/history screen exists (`app.js:792-802`). Visual comparison and full browser flow unverified. |
| Mutual ratings | PASS | Both Gear parties can rate after completion/resolution (`server.mjs:1253-1263`); existing test exercises rating. |

### C. Hire workflow

| Requirement | Result | Evidence and verification |
| --- | --- | --- |
| Price, slot, scope confirmation | PARTIAL | Fixed listing price, one preferred date, details, and owner acceptance (`app.js:200-224`, `server.mjs:1067-1091,1268-1286`); no time slot or two-party scope confirmation. |
| On-the-way | MISSING | Hire transitions in `server.mjs:1284-1292` jump from accepted to completion proposal. |
| Provider photo and start code | MISSING | Profile photo exists (`server.mjs:627-635`), but no arrival screen or code route in Hire transitions. |
| Before photos | MISSING | Evidence route explicitly restricts photos to Gear (`server.mjs:1103-1104`). |
| Add-on approval | MISSING | No add-on model/route in `database.mjs` or Hire transitions. |
| After photos | MISSING | Gear-only evidence route (`server.mjs:1103-1104`). |
| Customer approval | PASS | Hire owner proposes completion; customer completes (`server.mjs:1284-1292`). Existing transition tests/source review. |
| Automatic completion window | MISSING | Scheduled claim completion is Gear payment/claim based (`server.mjs:252-293`); no Hire auto-complete timer. |
| Receipt | MISSING | No Hire receipt route/view found in `server.mjs` or `app.js`. |
| Ratings with photos | PARTIAL | Customer text rating exists (`server.mjs:1264-1270`); no rating image upload. |

### D. Both portals

| Requirement | Result | Evidence and verification |
| --- | --- | --- |
| No-show handling | MISSING | No no-show state or endpoint in transition map (`server.mjs:1283-1293`). |
| Cancellation rules | PARTIAL | Gear paid cancellation has time rule (`server.mjs:1271-1278`); no comprehensive Hire/no-show policy automation. |
| Rescheduling | MISSING | No authorized date-change endpoint in `server.mjs:1268-1318`. |
| Notifications | PARTIAL | Email outbox for events (`server.mjs:30-56`); no in-app notification inbox or scheduled return/appointment reminders. |
| Report on every booking | MISSING | Listing report route (`server.mjs:1322-1330`) and Gear owner claim exist; no general report control for every booking, especially Hire. |
| Timeline view | PARTIAL | Thread UI lists accepted/pickup/return/completed times (`app.js:900-907`); many requested milestones absent. Visual review unavailable. |
| Audit log for every status change | PARTIAL | Runtime transitions append booking audit rows (`server.mjs:1119-1129,1306-1313`); seeded bookings are inserted directly into later states (`scripts/demo-seed.mjs:61-64`). Local SQL found **80 demo bookings, 0 booking status audit rows**. |

### E. Earlier portal features

| Requirement | Result | Evidence and verification |
| --- | --- | --- |
| Availability calendar and live total | PARTIAL | Gear request calendar and quote exist (`app.js:169-224`); date inputs remain independently editable and visual behavior was not browser tested. |
| Filters, distance | PARTIAL | Weekend/budget controls, API category/price/date/rating/distance sorting (`borrow.html:156-157`, `borrow.js:16-33,135-158`, `server.mjs:680-727`); distance appears only with shared location. |
| Richer listings | PARTIAL | Demo extras display only in desktop detail (`borrow.js:69`, `borrow.html:69-70,109`); regular listings accept one photo (`app.js:133,558`, `server.mjs:1014-1023`). Included items/condition notes are prose/checklist, not separate rich fields. |
| Owner tools | PARTIAL | Publish/unpublish, duplicate, date blocks (`app.js:687,1081-1088`, `server.mjs:654-679,1027-1047`); suggested price absent. |
| Role switch | MISSING | No per-user Borrow/Lend or Hire/Offer preference in `database.mjs:6-421`; portal selector is session state (`borrow.js:3-6`). |
| My rentals / My listings / My jobs / My services | PARTIAL | Activity and seller sections (`app.js:685-688`), but no four separate views. |
| Calendar tab | MISSING | Per-listing availability exists; no combined pickups/returns/appointments tab in navigation (`borrow.html:147-161`). |
| Earnings tab | PARTIAL | Seller summary (`app.js:688,700-704`); no separate earnings tab for providers and no complete pending/completed summary. |
| Profile progress | MISSING | Required profile gate exists (`server.mjs:607`); no completion bar/tips in `app.js`. |
| Unified Gear and Help search | MISSING | Gear frame search (`borrow.html:143`, `borrow.js:130-135`) and portal-specific searches; no grouped cross-portal results. |
| Post a job and quotes | MISSING | Hire listing/request model only (`database.mjs:8-10`, `server.mjs:1067-1091`); no job/quote tables or routes. |
| Fixed-price services | PASS | Help listings have a price and can receive a booking request (`server.mjs:972-1025,1067-1091`). |
| Provider profiles | MISSING | Only basic user name/photo/phone fields (`database.mjs:6`); no skills, service area, hours, work gallery. |
| Time slots | MISSING | Hire uses a date only (`app.js:200-218`, `server.mjs:1067-1075`). |
| Saved searches | MISSING | `saved` stores listing IDs, not queries (`database.mjs:9`). |
| Wanted board | MISSING | No wanted-post model in `database.mjs:6-421` or route in `server.mjs`. |
| Help/FAQ | MISSING | Static routes list terms/privacy/cancellation/banned items (`server.mjs:60`), no Help or FAQ route. |
| English and Hindi | MISSING | UI strings are hardcoded English (for example `app.js:200-224`, `borrow.js:5-10`); no language preference or string catalogue. |

## Break tests and security observations

An audit-only script spawned an in-memory `NODE_ENV=test` server, created three verified users, one Gear listing, and two simultaneous requests. Observed HTTP results:

- Other booking participant attempting to read/post the first booking's messages: **404/404**. Other participant listing/uploading evidence on the first booking: **404/404**. The sampled IDOR checks passed; this was not an exhaustive audit of every endpoint.
- Renter trying owner acceptance: **409**; owner skipping requested directly to active: **409**; simultaneous acceptance of one unit: **200/409**; repeat acceptance: **409**; attempted completed transition from accepted: **409**. The sampled state and concurrency checks passed. Both simultaneous *requests* returned 200 because conflict is enforced at acceptance.
- Bogus JPEG bytes: **400**; image over 1 MB: **413**; invalid date: **400**; oversized JSON: **400**; unexpected nested message body: **400**. Server upload/type/body/date checks are at `storage.mjs:5-21`, `server.mjs:82-95,157-168,1067-1076`.
- Booking evidence uses server upload time (`server.mjs:1111-1117`), accepts only unconsumed uploads tied to the current user and purpose (`:1107-1114`), and has an immutable database trigger (`database.mjs:245-256`). No evidence replacement/deletion endpoint was found. Individual evidence access checks booking participation (`server.mjs:930-942`). A full matrix over every upload purpose and every role was not run.
- No four-digit arrival/handover code exists, so brute-force resistance and lockout for that code are **not applicable and unverified**. Phone OTP has five attempts per challenge (`server.mjs:590-600`); it is a different flow.
- SQL calls reviewed use parameters for untrusted values. The probes above did not establish an injection exploit. This is not a full injection or dependency security review.
- Migration 11 applied to the local existing SQLite database without removing its three non-demo users (local SQL: 43 total users, 40 marked demo); the suite opened an empty database and migrated all 11 versions. PostgreSQL/Supabase migrations and backup restore were not run in this audit environment.

## Ranked bugs and gaps

### Critical

No Critical exploit was reproduced in the sampled tests. This does **not** certify the full API or payment system.

### High

**H1 — Demo reset leaves real bookings orphaned.** `scripts/demo-seed.mjs:28-36` deletes demo listings and users but only deletes *marked* requests. Reproduce on a disposable DB: seed, create a real user and a non-demo request for a demo listing, run `seed:reset`, then left-join request to listing. Observed `resetStatus: 0`, `orphanRequests: 1`. The official test preserves an unrelated real listing but never tests interactions with demo listings. Reset should refuse or safely handle cross-boundary references before deletion.

**H2 — Seeded active/completed bookings are display-only and lack lifecycle records.** `scripts/demo-seed.mjs:59-66` inserts advanced statuses directly; local SQL found 80 demo requests but zero matching `booking_status_audit`, `booking_evidence`, or `protected_payments`. Reproduce by signing in as demo.renter and opening an active rental: it can display an active status without handover evidence/payment history. These rows should be clearly read-only simulations or be seeded with consistent supporting records.

### Medium

**M1 — Requested journeys are not implemented.** Gear handover/return codes, checklists, extensions, and Hire arrival/progress/photos/quotes are absent at the state boundary (`server.mjs:1103-1136,1268-1318`). Reproduce by opening a Gear or Hire booking: only the existing limited actions are offered. Treat the feature brief as future work, not a completed product claim.

**M2 — Demo reset can leave other derived records behind.** `scripts/demo-seed.mjs:31-33` only cleans its seven marked tables and sessions. Runtime-created notification, booking audit, or payment rows involving demo users/listings have no demo marker or cleanup path. This was inferred from code; the H1 request orphan was reproduced.

**M3 — Additional demo photos are inaccessible in mobile Gear browsing.** Extra gallery is rendered in `borrow.js:69` inside `aside#detail`, while `borrow.html:109` hides `.detail` below 1280px. On mobile the card shows only its primary image. Static responsive review; headless screenshot was unavailable.

**M4 — Text below the specified 14px minimum.** `borrow.html:26,33,36,44,58,79,89,102,108` and `app.css:16,73,95-103,117,124` set 9–13px text. Reproduce at the CSS declarations; actual computed sizes and legibility were not visually checked.

### Low

**L1 — “Deterministic” seed is date-dependent.** `scripts/demo-seed.mjs:39,59-65` builds dates and message timestamps from the current clock. The same random sequence produces different date fields on another day.

**L2 — Extra images exist only for seeded listings.** `server.mjs:58,1388-1400` serves `demo_listing_photos`; regular listing creation stores one uploaded photo (`server.mjs:1014-1023`). The richer-listing feature remains partial.

## Claims that do not survive verification

- “Reset removes only demo rows while preserving normal users and listings” is true only for unrelated records; it can corrupt a real booking of demo inventory (H1).
- “The demo accounts have the promised sample states” is only true collectively for selected roles. Local SQL showed demo.admin had accepted/cancelled renter bookings and no pending owner work or active/completed rental.
- “Multiple listing photos” applies to generated demo extras, not user-uploaded listings, and the extra gallery is hidden at mobile width.
- Broad earlier phase completion claims do not establish the Gear/Hire feature checklist above. Many named flows have no schema, endpoint, or UI control.

## Recommended fix order

1. Make demo reset safe across real-user references, including bookings and derived records; add cross-boundary tests.
2. Decide whether advanced demo bookings are read-only simulations or valid workflow examples; make data consistent with that choice and label artwork clearly.
3. Implement missing Gear safety and confirmation states on the server before adding more UI controls; test authorization and transition races.
4. Build the Hire job/quote/arrival/progress model with migrations and isolated tests.
5. Add mobile access to extra images, fix sub-14px text, and run a true two-user desktop/mobile browser walkthrough once an approved browser tool is available.

## Explicit verification limits

Supabase/PostgreSQL was not connected. Payment-provider behavior was exercised only by the repository's mock tests, not a real sandbox. A full endpoint-by-endpoint IDOR matrix, browser interactions, photo comparison layout, and visual dark/light/mobile QA remain unverified. The automatic approval review rejected the unpinned `npx --yes agent-browser` package execution; browser walkthrough needs an approved installed tool or explicit authorization for that package. No production system was touched.
