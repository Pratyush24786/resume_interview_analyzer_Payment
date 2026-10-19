# CareerMatch billing setup (Cloudflare Workers + D1 + Razorpay)

The homepage pricing buttons call `POST /api/billing/checkout`. `worker.js` creates Razorpay subscriptions and validates Razorpay webhook signatures before updating the D1 subscription status. The static site must be served by the same Worker origin, with these API routes sent to this module.

## Before taking payments

1. Create Razorpay monthly subscription plans in the Razorpay dashboard: ₹199 for Pro and ₹499 for Career Plus. Put their plan IDs in Worker secrets/vars named `PRO_RAZORPAY_PLAN_ID` and `CAREER_PLUS_RAZORPAY_PLAN_ID`.
2. Create a Cloudflare D1 database and run `schema.sql` against it. Bind that database to the Worker as `DB`.
3. Add Worker secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Never put these values in `config.js` or browser code.
4. Configure Razorpay webhooks to call `/api/billing/webhook` and subscribe to `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.paused`, and `subscription.resumed`.
5. Connect an authentication provider. It must create `users` rows and issue a cryptographically random session token in a Secure, HttpOnly, SameSite=Lax cookie named `cm_session`; store only SHA-256(token) in `sessions.token_hash`, with an expiry. The Worker rejects checkout without this verified server-side session.

## Important integration work

This project currently has no authentication provider or server entry point in its source tree. Route the site's asset requests and both API paths through a Cloudflare Worker that imports `worker.js`, and integrate a real login/register flow before enabling paid checkout. The `sessions` table contract is ready for that integration, but this module intentionally does not invent or trust an email address supplied by the browser.

Before unlocking premium features, check the authenticated user's latest subscription row and allow access only for active/trialing status with an unexpired `current_period_end`. Enforce usage limits and premium reports on server endpoints; hiding controls in JavaScript is not security. The existing resume analyzer runs locally in the browser, so its current features cannot be securely restricted by this billing module alone.

Use Razorpay test mode first. Confirm successful, failed, cancelled, renewed, expired, duplicate, and invalid-signature webhook cases before switching to live keys. Add a customer self-service cancellation/renewal portal before launching subscriptions.
