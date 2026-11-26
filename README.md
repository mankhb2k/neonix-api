# neonix-api

Backend for the Neonix iOS app: accounts, credits (Apple IAP), creator templates (R2) and
export authorization. Video export itself runs on the user's device.

## Flow

1. Sign in with Apple/Google → Better Auth session, sent as `Authorization: Bearer <token>`.
2. Shop: `GET /v1/billing/packs`. Buy with StoreKit 2 → `POST /v1/billing/purchases { signedTransaction }` (safe to retry). Refunds arrive on `POST /webhooks/apple`. Balance/history: `GET /v1/billing/balance`, `/ledger`, `/purchases`.
3. Browse `GET /v1/templates`, download the zip free with `GET /v1/templates/:id/package`. At Export: `POST /v1/exports { templateId }`: the **first export of a template buys it** (its credit price is spent); every later export of that template, in any project, is free (see Buying a template below).
4. The device exports locally. There is no refund endpoint and no per-export fee: an owned template exports for free forever (`charged: false`). The catalogue tells each user which templates they `owned`.
5. Creators (`profiles.role = creator`): create template → upload a **poster** (required, still image) and optionally a short looping preview mp4 → upload the version zip to R2 → `submit`. `src/templates/review-policy.ts` decides the review; today it approves everything (tighten there, or return `manual` to queue versions for `/v1/admin/template-versions`).
6. Admin sets, per template, the price (`creditCost`, default 6) and the creator's fixed earning per export in VND (`creatorEarningVnd`) via `PATCH /v1/admin/templates/:id`. Creators cannot change either.

Roles (`creator`, `admin`) are set directly in the `profiles` table. Sign-in is Apple + Google only.

## API conventions

- Everything under `/v1`; errors are `{ "error": { "code", "message", "details" } }`.
- Lists return `{ items, nextCursor }`; pass `nextCursor` back as `?cursor=` (and `?limit=`). `nextCursor: null` = last page.
- `POST /v1/exports` is safe to retry and double-tap: the first call per (user, template) pays, every later call is free. Not enough credits = 402 and nothing is recorded.
- Swagger at `/docs`, grouped by tag: Auth, Billing, Templates, Creator, Exports, Admin, Webhooks, System.

## Buying a template

A template is bought once, by the first export of it (`template_purchases`, one row per user + template, which is
also the sale record creator earnings are paid from). `templates.use_count` counts owners. Pro add-ons planned for
later are separate purchases on top of this one (a per-template feature with its own price), not a per-export fee.
Downloading a template package is always free so it can be opened and tried before paying.

## Creator payouts (weekly, Vietnamese bank accounts only)

- Each **purchase** (a user's first export of a template) snapshots the creator and `creatorEarningVnd` and is immediately payable. Later free exports earn nothing, so a creator earns once per buyer.
- Creator saves a bank account: `PUT /v1/creator/payout-account`; sees `GET /v1/creator/earnings`.
- Every Monday the admin calls `POST /v1/admin/payouts/generate`: one `pending` payout per creator for the last finished Mon-Sun week (Vietnam time). Creators without a bank account are skipped and roll over.
- Admin transfers by hand, then `POST /v1/admin/payouts/:id/mark-paid { transferReference }`.

## Sign-in (Google now, Apple later)

Apple turns on automatically once `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET` are set.

iOS (native, Google Sign-In SDK): send the Google ID token, keep the session token from the
`set-auth-token` response header and use it as `Authorization: Bearer <token>` on every call.

```
POST /api/auth/sign-in/social
{ "provider": "google", "idToken": { "token": "<google id token>" } }
```

- The ID token's audience must equal `GOOGLE_CLIENT_ID`. In the iOS SDK set `serverClientID` to the
  **Web** OAuth client id and use that same value as `GOOGLE_CLIENT_ID` here.
- Browser flow (testing): `POST /api/auth/sign-in/social { "provider": "google", "callbackURL": "/" }`
  returns a Google URL; the Google console needs redirect URI `{BETTER_AUTH_URL}/api/auth/callback/google`.

## Sign-in on desktop (through the browser)

The desktop app never shows a login form: it uses Better Auth's device authorization (RFC 8628, `deviceAuthorization()` in `src/auth/auth.ts`).

1. The app `POST /api/auth/device/code { "client_id": "neonix-desktop" }` and gets `device_code`, `user_code`, `verification_uri_complete`, `interval`, `expires_in`. Only the ids in `deviceClients` are accepted.
2. The app opens `verification_uri_complete` (`GET /device`, served by `src/auth/device.controller.ts`). The page signs the person in with Google on this origin, shows the client and the code, and asks for Approve or Deny (`POST /api/auth/device/approve` or `/deny`). Approve only if the code is the one the app shows.
3. The app polls `POST /api/auth/device/token { grant_type, device_code, client_id }` every `interval` seconds: `400 authorization_pending` (keep going), `slow_down` (wait 5 s more), `access_denied`, `expired_token`, then `200 { access_token }`. The `access_token` is a session token: send it as `Authorization: Bearer <token>` like the iOS app's, and `GET /api/auth/get-session` says who it is.
4. Sign out: `POST /api/auth/sign-out` with the Bearer.

The `device_code` table is migration `0010_device_code.sql`. The page is never to be framed (`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`). In production serve it over HTTPS; the Google console needs `{BETTER_AUTH_URL}/api/auth/callback/google` as a redirect URI, as for the browser flow above. Tests: `src/auth/device-flow.test.ts` (PGlite, the real plugin, over HTTP too) and `src/auth/device-page.test.ts`.

## Sound-effect library

The built-in sounds live in the system-assets bucket under `soudeffects/`: `manifest.json` (categories, and for each sound its id, name, file, length and waveform peaks) and one file per sound at `soudeffects/<category>/<name>.<mp3|m4a|wav>`. The desktop app reads the manifest and the files straight from the public assets host (`https://assets.neonix.video/`, no sign-in); `GET /v1/sounds` (`src/sounds/`) serves the same catalogue to signed-in clients.

`scripts/publish_sounds.mjs` puts a folder of category folders (kebab-case file names) in the bucket and merges the sounds into the published manifest: `node --env-file=.env scripts/publish_sounds.mjs --src "<folder>"` encodes to `.m4a` and reports what it would do, `--upload` writes it, `--keep-format --manifest-only --upload` publishes only the manifest for files uploaded by hand. A sound with the same id replaces the published one. Tests: `npx vitest run scripts/publish_sounds.test.mjs`.

## Setup

```
cp .env.example .env            # fill in
docker compose -f docker-compose.dev.yml up -d
pnpm install
pnpm db:generate && pnpm db:migrate   # first run creates the initial migration
pnpm dev                              # Swagger at /docs
```

Credit packs live in the `credit_packs` table; the admin manages them with `PUT /v1/admin/credit-packs/:productId { credits, active, sortOrder }` (product ids must match App Store Connect). Apple root CAs for
verifying IAP signatures are in `certs/` (add more `.cer` files there if Apple rotates).
