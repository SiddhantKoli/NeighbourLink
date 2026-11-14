# NeighbourLink portal features plan

## Current architecture

- Node 24 HTTP server (`server.mjs`) serves a versioned JSON API and plain HTML, CSS, and JavaScript. `app.js` owns authentication, account views, and API calls; `borrow.js` and `portal.js` render the Gear and Local Help portal frames.
- `database.mjs` applies ordered migrations to SQLite or the private Supabase PostgreSQL schema. Private photos use the storage adapter. Existing tables cover users, listings, requests, messages, availability blocks, ratings, notifications, and shops.
- Gear has date requests, an owner availability block API, price quotes, nearby search, ratings, and seller listing status/duplicate controls. Local Help has service listings and booking requests. `marketplace.test.mjs` exercises the server flows.
- Older payment, identity, claim, and subscription code exists. This plan leaves those systems alone.

## Phase 1 — Gear portal essentials

1. Show booked and owner-blocked dates on a gear listing calendar; prevent selecting them in the browser and enforce overlap on the server.
2. Show a live date total and add weekend/price/nearest filters with distance and area-search fallback.
3. Add multiple listing images, included items, and condition notes through a migration and validated uploads. Show owner ratings, review count, response time, and a clearly labelled verification placeholder.
4. Expose pause/resume, duplicate, date blocks, and a category-based suggested price in owner UI. Add Borrow again and Message owner shortcuts using existing request and message permissions.

## Phase 2 — Account structure and navigation

1. Add a migration for per-user portal/role preference.
2. Separate borrowing, lending, hiring, and offering views; add a calendar and calculated earnings view.
3. Add profile completion guidance and grouped cross-portal search. Keep existing portal styling and light/dark themes.

## Phase 3 — Local Help

1. Migrate jobs, job images, quotes, provider profiles, availability slots, and job progress/arrival records without altering existing bookings.
2. Build post-job, compare/accept/decline quote, fixed-price service, provider directory, and time-slot flows with server authorization and conflict checks.
3. Add arrival code, progress, receipt, report shortcut, and photo-supported review UI.

## Phase 4 — Notifications and discovery

1. Migrate in-app notification reads, saved searches, wanted posts/responses, and language preference.
2. Add notification filters, return and appointment reminder jobs through the existing email outbox, saved-search alerts, and a wanted board.
3. Add Help/FAQ, booking report links, and English/Hindi strings with a path for further languages.

## Delivery rules

Each phase gets server validation and authorization, migration coverage, meaningful tests, loading/empty/error states, desktop/mobile review, README updates, and a small commit before the next phase. No new framework is needed. New work in this plan does not expand payments, deposits, KYC, disputes, subscriptions, insurance, GPS, delivery, or recommendations.
