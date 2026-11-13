# NeighbourLink

Run `npm start` from this folder with Node.js 24 or later. Open http://127.0.0.1:8767/. Run `npm ci` once to install the PostgreSQL driver. Run `npm test` to check the marketplace flows using an isolated database.

The default database is `data/marketplace.sqlite`. Keep that directory on persistent storage and use SQLite-aware backups. Set `DB_PATH` to use a different database file. `PORT` and `HOST` override the loopback listener.

## Portal features

- Gear supports pickup and return dates, optional notes, and conflict checks for overlapping accepted rentals.
- Hire supports a preferred appointment date and a required description of the job.
- Both portals support publishing listings with a photo, filtering by category, neighbourhood search, saving listings, private request conversations, owner approval, and reporting.

## Supabase PostgreSQL

For project `lrqseeynurnzhsdsdzih`, open **Connect → Session pooler** in the Supabase dashboard. Put the PostgreSQL connection string in the server's `DATABASE_URL` environment variable. The server uses TLS certificate verification and creates its tables under the private `neighbourlink` schema. The Supabase publishable key is for client Data API access. The website and a future desktop app use NeighbourLink's server API.

For Windows local testing with Supabase, copy `.env.example` to `.env`, fill in the URL privately, and run `node --env-file=.env server.mjs`. The file is ignored by Git. Existing SQLite data stays in the local database and is not copied automatically. To use SQLite, start without setting `DATABASE_URL`.

## Pilot deployment

Run one application instance with persistent storage behind an HTTPS reverse proxy. Set `PUBLIC_ORIGIN` to the exact HTTPS origin and `COOKIE_SECURE=1`. Provision the moderation account with `ADMIN_EMAIL` and `ADMIN_SIGNUP_CODE` before exposing signup. Submit the code as `adminCode` on the signup endpoint during provisioning and remove the setup code afterward. The moderation queue appears in My Activity for this account.

The browser and a future Electron client can use the same versioned JSON endpoints under `/api/v1`. For the first Electron build, load the hosted HTTPS app with context isolation and sandboxing enabled and Node integration disabled. Keep auth and permissions enforced by the server.

This pilot uses neighborhood text search and manually coordinated bookings. Before opening public registration, add email ownership verification and account recovery, test backup restores, and configure monitoring and abuse controls. The capstone's payments, pickup/return OTPs, and supervised-provider workflows are later phases.


## Example listing photos

Empty portals display clearly labelled examples. Images are from Unsplash and are illustrative. Real listings display the photos their owners upload.

- [Camera photo](https://images.unsplash.com/photo-1516035069371-29a1b244cc32)
- [Tent photo](https://images.unsplash.com/photo-1504280390367-361c6d9f38f4)
- [Bicycle photo](https://images.unsplash.com/photo-1485965120184-e220f721d03e)
