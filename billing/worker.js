const PLANS = {
  pro: { amount: 19900, name: "CareerMatch Pro" },
  career_plus: { amount: 49900, name: "CareerMatch Career Plus" },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function authenticatedUser(request, env) {
  const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)cm_session=([^;]+)/)?.[1];
  if (!token) return null;
  const tokenHash = await sha256(decodeURIComponent(token));
  return env.DB.prepare(`SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at > datetime('now')`)
    .bind(tokenHash).first();
}

async function checkout(request, env) {
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Sign in to choose a paid plan." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const plan = PLANS[body.plan];
  const planId = env[`${String(body.plan).toUpperCase()}_RAZORPAY_PLAN_ID`];
  if (!plan || !planId) return json({ error: "That plan is not configured for checkout." }, 400);

  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1, notes: { user_id: user.id, plan: body.plan } }),
  });
  const subscription = await response.json();
  if (!response.ok) return json({ error: "Could not create a subscription. Please try again." }, 502);

  await env.DB.prepare(`INSERT INTO subscriptions (id,user_id,plan,provider_subscription_id,status) VALUES (?,?,?,?,?)`)
    .bind(crypto.randomUUID(), user.id, body.plan, subscription.id, subscription.status || "created").run();
  if (!subscription.short_url) return json({ error: "Razorpay did not return a checkout link." }, 502);
  return json({ checkoutUrl: subscription.short_url });
}

async function webhook(request, env) {
  const raw = await request.text();
  const supplied = request.headers.get("X-Razorpay-Signature") || "";
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
  if (!equal(supplied, expected)) return json({ error: "Invalid signature." }, 401);

  const event = JSON.parse(raw);
  const eventId = request.headers.get("X-Razorpay-Event-Id");
  if (!eventId) return json({ error: "Missing event ID." }, 400);
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO processed_webhooks (event_id) VALUES (?)").bind(eventId).run();
  if (!claimed.meta.changes) return json({ ok: true, duplicate: true });

  const subscription = event.payload?.subscription?.entity;
  const allowed = new Set(["subscription.activated", "subscription.charged", "subscription.halted", "subscription.cancelled", "subscription.completed", "subscription.paused", "subscription.resumed"]);
  if (subscription?.id && allowed.has(event.event)) {
    const periodEnd = subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null;
    await env.DB.prepare(`UPDATE subscriptions SET status=?, current_period_end=?, updated_at=CURRENT_TIMESTAMP WHERE provider_subscription_id=?`)
      .bind(subscription.status || event.event.split(".")[1], periodEnd, subscription.id).run();
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/billing/checkout") return checkout(request, env);
    if (request.method === "POST" && url.pathname === "/api/billing/webhook") return webhook(request, env);
    return json({ error: "Not found." }, 404);
  },
};
