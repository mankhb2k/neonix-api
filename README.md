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
